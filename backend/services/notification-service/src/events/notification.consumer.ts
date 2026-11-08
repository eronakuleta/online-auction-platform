// Event handlers of notification-service (B-14). Each one builds the notifications with the pure
// builder and stores them in one statement, which is atomic and idempotent (see
// insertNotifications). A handler that throws is retried by the shared consumer and finally
// dead-lettered (docs/events.md §6), so a database outage loses nothing.
import type { DomainEvent, EventHandlers, EventType, Logger } from '@auction/shared-common';
import type { Pool } from 'pg';
import { insertNotifications } from '../repositories/notification.repository';
import {
  fromAuctionCancelled,
  fromAuctionClosed,
  fromBidPlaced,
  fromPaymentCompleted,
  fromPaymentFailed,
  fromUserRegistered,
  type NewNotification,
} from '../services/notification-builder';

export function createNotificationHandlers(deps: {
  pool: Pool;
  logger: Logger;
}): EventHandlers<'notification-service'> {
  const { pool, logger } = deps;

  async function store<T extends EventType>(
    event: DomainEvent<T>,
    notifications: NewNotification[],
  ): Promise<void> {
    const created = await insertNotifications(pool, event.eventId, notifications);
    logger.info(
      { eventId: event.eventId, eventType: event.type, wanted: notifications.length, created },
      'notifications stored',
    );
  }

  return {
    'user.registered': (event) => store(event, fromUserRegistered(event.payload)),
    'bid.placed': (event) => store(event, fromBidPlaced(event.payload)),
    'auction.closed': (event) => store(event, fromAuctionClosed(event.payload)),
    'auction.cancelled': (event) => store(event, fromAuctionCancelled(event.payload)),
    'payment.completed': (event) => store(event, fromPaymentCompleted(event.payload)),
    'payment.failed': (event) => store(event, fromPaymentFailed(event.payload)),
  };
}
