// Display text for auction states, in one place so every page says the same thing.
import type { Auction, AuctionStatus } from '../api/auctions';

export const STATUS_LABELS: Record<Exclude<AuctionStatus, 'DRAFT'>, string> = {
  PUBLISHED: 'Open and upcoming',
  CLOSED_SOLD: 'Sold, awaiting payment',
  SETTLED: 'Sold and paid',
  PAYMENT_FAILED: 'Sold, payment failed',
  CLOSED_NO_SALE: 'Ended without a sale',
  CANCELLED: 'Cancelled',
};

type ChipColor = 'default' | 'success' | 'info' | 'warning' | 'error';

/** The short label and colour shown on a card: live/upcoming/ended while open, else the result. */
export function stateChip(auction: Auction): { label: string; color: ChipColor } {
  if (auction.status === 'PUBLISHED') {
    if (auction.phase === 'LIVE') return { label: 'Live', color: 'success' };
    if (auction.phase === 'UPCOMING') return { label: 'Upcoming', color: 'info' };
    return { label: 'Closing', color: 'warning' };
  }
  if (auction.status === 'DRAFT') return { label: 'Draft', color: 'default' };
  const color: ChipColor =
    auction.status === 'CANCELLED' || auction.status === 'PAYMENT_FAILED' ? 'error' : 'default';
  return { label: STATUS_LABELS[auction.status], color };
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
