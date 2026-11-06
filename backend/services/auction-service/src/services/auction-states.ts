import type { AuctionStatus } from '../repositories/auction.repository';

/**
 * Every allowed change of an auction's persisted status (ROADMAP §4), in one place. Anything not
 * listed is refused: a closed auction never reopens, and only a sold one can be settled.
 *
 *   DRAFT       -> PUBLISHED (publish), CANCELLED (cancel)
 *   PUBLISHED   -> CANCELLED (cancel), CLOSED_SOLD or CLOSED_NO_SALE (auction.closed)
 *   CLOSED_SOLD -> SETTLED (payment.completed), PAYMENT_FAILED (payment.failed)
 *   the other four are final.
 */
const ALLOWED_TRANSITIONS: Record<AuctionStatus, readonly AuctionStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['CANCELLED', 'CLOSED_SOLD', 'CLOSED_NO_SALE'],
  CLOSED_SOLD: ['SETTLED', 'PAYMENT_FAILED'],
  CLOSED_NO_SALE: [],
  CANCELLED: [],
  SETTLED: [],
  PAYMENT_FAILED: [],
};

export function canMoveTo(from: AuctionStatus, to: AuctionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
