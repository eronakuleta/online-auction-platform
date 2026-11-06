import type { Queryable } from './database';

/**
 * Records that an event was handled. Returns false if it was already recorded, which means this is
 * a redelivery and must be skipped. Call it inside the same transaction as the event's effect: if
 * the effect rolls back, so does this row, and the retried event is handled again.
 * Two deliveries of the same event at once are safe too: the second INSERT waits for the first
 * transaction on the primary key and then inserts nothing.
 */
export async function markEventProcessed(
  db: Queryable,
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType],
  );
  return rowCount === 1;
}
