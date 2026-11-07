// SQL for the idempotency_keys table (database/bidding/001_schema.sql, B-10).
import type { Queryable } from './database';

export interface StoredKey {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
}

/** A request that started this long ago without finishing is treated as crashed. */
const ABANDONED_AFTER = "interval '60 seconds'";

/**
 * Claims the key for this request. Returns true if this request may run. A key left unfinished by a
 * crashed request is taken over after a while, but only by the same request.
 */
export async function claimKey(
  db: Queryable,
  userId: string,
  key: string,
  requestHash: string,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET created_at = now()
       WHERE idempotency_keys.response_status IS NULL
         AND idempotency_keys.request_hash = EXCLUDED.request_hash
         AND idempotency_keys.created_at < now() - ${ABANDONED_AFTER}`,
    [userId, key, requestHash],
  );
  return result.rowCount === 1;
}

export async function findKey(
  db: Queryable,
  userId: string,
  key: string,
): Promise<StoredKey | null> {
  const result = await db.query<{
    request_hash: string;
    response_status: number | null;
    response_body: unknown;
  }>(
    'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
    [userId, key],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        requestHash: row.request_hash,
        responseStatus: row.response_status,
        responseBody: row.response_body,
      };
}

export async function completeKey(
  db: Queryable,
  userId: string,
  key: string,
  response: { status: number; body: unknown },
): Promise<void> {
  await db.query(
    `UPDATE idempotency_keys SET response_status = $3, response_body = $4, completed_at = now()
     WHERE user_id = $1 AND key = $2`,
    [userId, key, response.status, JSON.stringify(response.body)],
  );
}

/** Frees the key after a failure that a retry might fix (5xx), so the retry can run. */
export async function releaseKey(db: Queryable, userId: string, key: string): Promise<void> {
  await db.query(
    'DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND response_status IS NULL',
    [userId, key],
  );
}
