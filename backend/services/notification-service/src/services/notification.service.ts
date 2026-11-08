// What a user may do with their notifications (FR-13, B-15). No Express and no SQL here.
import { ForbiddenError, NotFoundError } from '@auction/shared-common';
import type { Pool } from 'pg';
import {
  countUnread,
  findOwner,
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
  type Page,
} from '../repositories/notification.repository';

export interface Pagination {
  page: number;
  size: number;
}

export interface NotificationService {
  list(userId: string, pagination: Pagination): Promise<Page<Notification>>;
  unreadCount(userId: string): Promise<number>;
  /** 404 if it does not exist, 403 if it belongs to someone else. Marking twice is harmless. */
  markRead(userId: string, notificationId: string): Promise<Notification>;
  /** Returns how many notifications changed. */
  markAllRead(userId: string): Promise<number>;
}

export function createNotificationService(pool: Pool): NotificationService {
  return {
    list: (userId, { page, size }) => listNotifications(pool, userId, size, (page - 1) * size),

    unreadCount: (userId) => countUnread(pool, userId),

    async markRead(userId, notificationId) {
      const updated = await markRead(pool, userId, notificationId);
      if (updated !== null) {
        return updated;
      }
      // Nothing changed for this user: either there is no such notification, or it is not theirs.
      const owner = await findOwner(pool, notificationId);
      if (owner === null) {
        throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
      }
      throw new ForbiddenError('This notification belongs to someone else');
    },

    markAllRead: (userId) => markAllRead(pool, userId),
  };
}
