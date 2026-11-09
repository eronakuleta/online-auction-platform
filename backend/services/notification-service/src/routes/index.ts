import { authenticate, type TokenVerifier } from '@auction/shared-auth';
import { Router } from 'express';
import { createNotificationController } from '../controllers/notification.controller';
import type { NotificationService } from '../services/notification.service';

/**
 * Public API under /api/v1, reached through the gateway. Every endpoint needs a login but no
 * particular role: BIDDER, SELLER and ADMIN all read their own notifications. A user can only ever
 * see or change their own, because every query filters by the user from the token.
 */
export function createRoutes(
  notifications: NotificationService,
  verifyToken: TokenVerifier,
): Router {
  const controller = createNotificationController(notifications);
  const requireLogin = authenticate(verifyToken);
  const router = Router();

  router.get('/notifications', requireLogin, controller.list);
  // Registered before the /:id route so "unread-count" is never read as an ID.
  router.get('/notifications/unread-count', requireLogin, controller.unreadCount);
  router.post('/notifications/read-all', requireLogin, controller.markAllRead);
  router.patch('/notifications/:id/read', requireLogin, controller.markRead);

  return router;
}
