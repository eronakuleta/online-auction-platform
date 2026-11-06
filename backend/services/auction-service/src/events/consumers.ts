import type { EventHandlers } from '@auction/shared-common';
import type { AuctionEventService } from '../services/auction-event.service';

/**
 * Wires each event auction-service subscribes to (SERVICE_SUBSCRIPTIONS in shared-common) to the
 * service method that handles it. The shared consumer has already checked the envelope and payload
 * against the contract, and it acks, retries or dead-letters the message based on the result.
 * Required<>: forgetting a subscribed event is a compile error, not messages in the dead-letter queue.
 */
export function createEventHandlers(
  events: AuctionEventService,
): Required<EventHandlers<'auction-service'>> {
  return {
    'auction.extended': (event) => events.applyExtension(event),
    'auction.closed': (event) => events.applyClosing(event),
    'payment.completed': (event) => events.applyPayment(event, 'SETTLED'),
    'payment.failed': (event) => events.applyPayment(event, 'PAYMENT_FAILED'),
  };
}
