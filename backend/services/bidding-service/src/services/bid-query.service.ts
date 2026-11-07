// Read side of bidding (B-08): live state, bid history and a user's own bids. Decision Q3 (Anesa,
// 07.11.2026): state and history are public and read-only, like the catalog and the SSE stream
// (docs/events.md §10); a user's own bids need a login. No Express and no SQL here.
import { NotFoundError } from '@auction/shared-common';
import type { Pool } from 'pg';
import {
  findAuctionState,
  listBidsOfAuction,
  listBidsOfBidder,
  type AuctionState,
  type Bid,
  type MyBid,
  type Page,
} from '../repositories/bidding.repository';

export interface Pagination {
  page: number;
  size: number;
}

export interface BidQueryService {
  getState(auctionId: string): Promise<AuctionState>;
  listBids(auctionId: string, pagination: Pagination): Promise<Page<Bid>>;
  listMyBids(bidderId: string, pagination: Pagination): Promise<Page<MyBid>>;
}

const offsetOf = ({ page, size }: Pagination) => (page - 1) * size;

export function createBidQueryService(pool: Pool): BidQueryService {
  /** A placeholder row (cancelled before it was published) has no data to show, like place-bid. */
  const requireKnownAuction = async (auctionId: string): Promise<AuctionState> => {
    const auction = await findAuctionState(pool, auctionId);
    if (auction === null || auction.startingPriceCents === null) {
      throw new NotFoundError('Auction not found', 'AUCTION_NOT_FOUND');
    }
    return auction;
  };

  return {
    getState: requireKnownAuction,

    async listBids(auctionId, pagination) {
      await requireKnownAuction(auctionId);
      return listBidsOfAuction(pool, auctionId, pagination.size, offsetOf(pagination));
    },

    listMyBids: (bidderId, pagination) =>
      listBidsOfBidder(pool, bidderId, pagination.size, offsetOf(pagination)),
  };
}
