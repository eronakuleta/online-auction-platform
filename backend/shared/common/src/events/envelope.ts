import { randomUUID } from 'node:crypto';
import { EVENT_CATALOG, envelopeSchema } from './contract';
import type { DomainEvent, EventPayload, EventType } from './contract';

/** Builds a new event. Throws if the payload breaks the contract, so bad events are never sent. */
export function createEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
): DomainEvent<T> {
  const entry = EVENT_CATALOG[type];
  return {
    eventId: randomUUID(),
    type,
    version: entry.version,
    occurredAt: new Date().toISOString(),
    payload: entry.schema.parse(payload),
  } as DomainEvent<T>;
}

export type ParsedEvent = { ok: true; event: DomainEvent } | { ok: false; reason: string };

/** Reads and checks a received message body. A failure here cannot be fixed by retrying. */
export function parseEvent(body: Buffer): ParsedEvent {
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    return { ok: false, reason: 'Message body is not valid JSON' };
  }

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return { ok: false, reason: 'Invalid event envelope' };
  }

  const { type, version } = envelope.data;
  if (!Object.hasOwn(EVENT_CATALOG, type)) {
    return { ok: false, reason: `Unknown event type: ${type}` };
  }
  const entry = EVENT_CATALOG[type as EventType];
  if (version !== entry.version) {
    return { ok: false, reason: `Unsupported version ${version} of ${type}` };
  }

  const payload = entry.schema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return { ok: false, reason: `Invalid payload for ${type}` };
  }
  return { ok: true, event: { ...envelope.data, payload: payload.data } as DomainEvent };
}
