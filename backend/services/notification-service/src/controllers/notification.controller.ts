import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { Notification } from '../repositories/notification.repository';
import { notificationIdParamsSchema, paginationQuerySchema } from '../schemas/notification.schemas';
import type { NotificationService } from '../services/notification.service';

/** What clients see. The event ID and user ID stay inside the service. */
function toNotificationResponse(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    auctionId: notification.auctionId,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function createNotificationController(notifications: NotificationService) {
  const list: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const pagination = paginationQuerySchema.parse(req.query);
    const { items, total } = await notifications.list(user.id, pagination);
    res.status(200).json({ data: items.map(toNotificationResponse), ...pagination, total });
  };

  const unreadCount: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    res.status(200).json({ unreadCount: await notifications.unreadCount(user.id) });
  };

  const markRead: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    const { id } = notificationIdParamsSchema.parse(req.params);
    res.status(200).json(toNotificationResponse(await notifications.markRead(user.id, id)));
  };

  const markAllRead: RequestHandler = async (req, res) => {
    const user = getAuthUser(req);
    res.status(200).json({ updated: await notifications.markAllRead(user.id) });
  };

  return { list, unreadCount, markRead, markAllRead };
}
