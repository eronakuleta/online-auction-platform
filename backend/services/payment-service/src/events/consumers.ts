import type { EventHandlers } from '@auction/shared-common';
import type { SettlementService } from '../services/settlement.service';
import type { WalletService } from '../services/wallet.service';

/**
 * Wires the events payment-service consumes to the service methods that handle them. The shared
 * consumer has already checked the envelope and payload against the contract, and it acks,
 * retries or dead-letters the message based on the result.
 * Required<>: forgetting a subscribed event is a compile error, not messages in the dead-letter queue.
 */
export function createEventHandlers(
  wallets: WalletService,
  settlements: SettlementService,
): Required<EventHandlers<'payment-service'>> {
  return {
    'user.registered': (event) => wallets.createWalletForNewUser(event.payload.userId),
    'auction.closed': (event) => settlements.handleAuctionClosed(event),
  };
}
