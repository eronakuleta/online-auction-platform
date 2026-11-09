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

interface NotificationRow {
  id: string;
  user_id: string;
  event_id: string;
  type: NotificationType;
  title: string;
  message: string;
  auction_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, user_id, event_id, type, title, message, auction_id, read_at, created_at';

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    type: row.type,
    title: row.title,
    message: row.message,
    auctionId: row.auction_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** One user's notifications, newest first. notifications_user_created_idx serves this query. */
export async function listNotifications(
  db: Queryable,
  userId: string,
  limit: number,
  offset: number,
): Promise<Page<Notification>> {
  const [rows, count] = await Promise.all([
    db.query<NotificationRow>(
      `SELECT ${COLUMNS} FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    db.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM notifications WHERE user_id = $1',
      [userId],
    ),
  ]);
  return { items: rows.rows.map(toNotification), total: count.rows[0]!.total };
}

/** notifications_user_unread_idx (a partial index) serves this query. */
export async function countUnread(db: Queryable, userId: string): Promise<number> {
  const result = await db.query<{ unread: number }>(
    'SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return result.rows[0]!.unread;
}

/**
 * Marks one of the user's notifications as read. COALESCE keeps the first read time, so doing it
 * twice changes nothing. Returns null if the user has no such notification.
 */
export async function markRead(
  db: Queryable,
  userId: string,
  notificationId: string,
): Promise<Notification | null> {
  const result = await db.query<NotificationRow>(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [notificationId, userId],
  );
  return result.rows[0] === undefined ? null : toNotification(result.rows[0]);
}

/** Who a notification belongs to, or null if it does not exist. */
export async function findOwner(db: Queryable, notificationId: string): Promise<string | null> {
  const result = await db.query<{ user_id: string }>(
    'SELECT user_id FROM notifications WHERE id = $1',
    [notificationId],
  );
  return result.rows[0]?.user_id ?? null;
}

/** Marks every unread notification of the user as read. Returns how many changed. */
export async function markAllRead(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return result.rowCount ?? 0;
}
