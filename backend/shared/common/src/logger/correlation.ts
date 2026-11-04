import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Holds the correlation ID for the current request or event, so log lines and error bodies can
// read it without passing it through every function call.
const storage = new AsyncLocalStorage<string>();

// IDs can come from outside (a header), so only safe characters reach the logs.
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

export function runWithCorrelationId<T>(correlationId: string, work: () => T): T {
  return storage.run(correlationId, work);
}

/** Returns the candidate if it is a safe ID, otherwise a new one. */
export function resolveCorrelationId(candidate: unknown): string {
  return typeof candidate === 'string' && SAFE_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}
