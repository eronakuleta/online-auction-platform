import type { MyBid } from '../../api/bidding';

type ChipColor = 'success' | 'warning' | 'default' | 'info' | 'error';

/** How one bid stands, from what the server says about the auction and about this bid. */
export function bidStanding(bid: MyBid): { label: string; color: ChipColor } {
  switch (bid.auctionStatus) {
    case 'OPEN':
      return bid.isHighest
        ? { label: 'Winning', color: 'success' }
        : { label: 'Not the highest', color: 'warning' };
    case 'CLOSED_SOLD':
      return bid.isHighest
        ? { label: 'Won', color: 'success' }
        : { label: 'Lost', color: 'default' };
    case 'CLOSED_NO_SALE':
      return { label: 'No sale', color: 'default' };
    case 'CANCELLED':
      return { label: 'Cancelled', color: 'error' };
  }
}
