// The only place with SQL for notification_db (database/notification/001_schema.sql). Every query
// is parameterized.
import type { Queryable } from './database';
import type { NewNotification, NotificationType } from '../services/notification-builder';

export interface Notification {
  id: string;
  userId: string;
  eventId: string;
  type: NotificationType;
  title: string;
  message: string;
  auctionId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Stores the notifications one event created. UNIQUE (event_id, user_id) with ON CONFLICT DO
 * NOTHING makes this idempotent: a redelivered event, or a retry after a failure half way, adds
 * only what is missing. Returns how many rows were really added.
 */
export async function insertNotifications(
  db: Queryable,
  eventId: string,
  notifications: NewNotification[],
): Promise<number> {
  if (notifications.length === 0) {
    return 0;
  }
  const values: unknown[] = [eventId];
  const rows = notifications.map((n) => {
    values.push(n.userId, n.type, n.title, n.message, n.auctionId);
    const at = values.length - 4;
    return `($1, $${at}, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`;
  });
  const result = await db.query(
    `INSERT INTO notifications (event_id, user_id, type, title, message, auction_id)
     VALUES ${rows.join(', ')}
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    values,
  );
  return result.rowCount ?? 0;
}
