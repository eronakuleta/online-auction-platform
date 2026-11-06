import type { EventHandlers } from '@auction/shared-common';
import type { WalletService } from '../services/wallet.service';

/**
 * Wires the events payment-service consumes to the service methods that handle them. The shared
 * consumer has already checked the envelope and payload against the contract, and it acks,
 * retries or dead-letters the message based on the result.
 *
 * auction.closed (settlement) is task A-18. Until then the shared consumer sends it to the
 * dead-letter queue as "no handler", so A-18 must reach development before or together with the
 * closing worker (B-11), or those events need to be replayed from the DLQ.
 */
export function createEventHandlers(wallets: WalletService): EventHandlers<'payment-service'> {
  return {
    'user.registered': (event) => wallets.createWalletForNewUser(event.payload.userId),
  };
}
