// Idempotency-Key handling for POST /auctions/:id/bids (ROADMAP §4 rule 6, docs/events.md §10).
// The same key with the same request returns the original answer instead of placing a second bid;
// the same key with a different request is a 409. No Express and no SQL here.
import { createHash } from 'node:crypto';
import { AppError, ConflictError, type ErrorDetail } from '@auction/shared-common';
import type { Pool } from 'pg';
import { claimKey, completeKey, findKey, releaseKey } from '../repositories/idempotency.repository';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyService {
  /** Runs `work` once per (user, key). `replayed` is true when the stored answer is returned. */
  run(
    userId: string,
    key: string,
    request: unknown,
    work: () => Promise<StoredResponse>,
  ): Promise<StoredResponse & { replayed: boolean }>;
}

/** SHA-256 of the request, so a reused key with a different body can be detected. */
export function hashRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

type StoredError = { error: { code: string; message: string; details: ErrorDetail[] } };

export function createIdempotencyService(pool: Pool): IdempotencyService {
  return {
    async run(userId, key, request, work) {
      const requestHash = hashRequest(request);

      if (await claimKey(pool, userId, key, requestHash)) {
        try {
          const response = await work();
          await completeKey(pool, userId, key, response);
          return { ...response, replayed: false };
        } catch (err) {
          // A rule rejection (4xx) is the answer to this request, so a retry gets the same one.
          // Anything else (503, a bug) may succeed next time, so the key is freed.
          if (err instanceof AppError && err.status < 500) {
            const body: StoredError = {
              error: { code: err.code, message: err.message, details: err.details },
            };
            await completeKey(pool, userId, key, { status: err.status, body });
          } else {
            await releaseKey(pool, userId, key);
          }
          throw err;
        }
      }

      const stored = await findKey(pool, userId, key);
      if (stored !== null && stored.requestHash !== requestHash) {
        throw new ConflictError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request',
        );
      }
      if (stored === null || stored.responseStatus === null) {
        throw new ConflictError(
          'IDEMPOTENCY_KEY_IN_PROGRESS',
          'A request with this Idempotency-Key is still being processed',
        );
      }
      if (stored.responseStatus >= 400) {
        // Rebuilt as an error, so the response gets this request's own requestId.
        const { error } = stored.responseBody as StoredError;
        throw new AppError(stored.responseStatus, error.code, error.message, error.details);
      }
      return { status: stored.responseStatus, body: stored.responseBody, replayed: true };
    },
  };
}
