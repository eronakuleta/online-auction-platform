// Business rules for bids (ROADMAP §4, CLAUDE.md "Place bid"). No Express and no SQL here.
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Logger,
  type Publish,
} from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction } from '../repositories/database';
import {
  currentTime,
  insertBid,
  lockAuctionState,
  markCancelled,
  recordHighestBid,
  type AuctionState,
  type Bid,
} from '../repositories/bidding.repository';

export interface BiddingDependencies {
  pool: Pool;
  publish: Publish;
  logger: Logger;
}

export interface PlaceBidResult {
  bid: Bid;
  auction: AuctionState;
}

export interface BiddingService {
  placeBid(bidderId: string, auctionId: string, amountCents: number): Promise<PlaceBidResult>;
  /** The internal cancel call from auction-service (docs/events.md §8). */
  cancelAuction(
    auctionId: string,
    request: { cancelledBy: string; isAdmin: boolean },
  ): Promise<void>;
}

/** The lowest amount the next bid may have: the starting price, or highest + increment. */
export function minimumNextBid(auction: AuctionState): number {
  if (auction.highestBidCents === null) {
    return auction.startingPriceCents!;
  }
  return auction.highestBidCents + auction.minIncrementCents!;
}

const auctionNotFound = () => new NotFoundError('Auction not found', 'AUCTION_NOT_FOUND');

/** Throws unless the auction accepts bids at this moment. */
function assertOpenForBids(auction: AuctionState, now: Date): void {
  if (auction.status === 'CANCELLED') {
    throw new ConflictError('AUCTION_CANCELLED', 'This auction was cancelled');
  }
  if (auction.status !== 'OPEN' || now >= auction.endsAt!) {
    throw new ConflictError('AUCTION_CLOSED', 'This auction has ended');
  }
  if (now < auction.startsAt!) {
    throw new ConflictError('AUCTION_NOT_STARTED', 'Bidding has not started yet');
  }
}

function assertBidAllowed(auction: AuctionState, bidderId: string, amountCents: number): void {
  if (bidderId === auction.sellerId) {
    throw new ForbiddenError('You cannot bid on your own auction', 'OWN_AUCTION');
  }
  if (bidderId === auction.highestBidderId) {
    throw new ConflictError('ALREADY_HIGHEST_BIDDER', 'You already have the highest bid');
  }
  const minimum = minimumNextBid(auction);
  if (amountCents < minimum) {
    throw new ConflictError('BID_TOO_LOW', `Bid must be at least ${minimum}`);
  }
}

export function createBiddingService(deps: BiddingDependencies): BiddingService {
  const { pool, publish, logger } = deps;

  return {
    async placeBid(bidderId, auctionId, amountCents) {
      let previousHighestBidderId: string | null = null;

      const result = await withTransaction(pool, async (tx) => {
        const auction = await lockAuctionState(tx, auctionId);
        // A placeholder row (cancelled before it was published) has no snapshot to bid on.
        if (auction === null || auction.startingPriceCents === null) {
          throw auctionNotFound();
        }
        const now = await currentTime(tx);
        assertOpenForBids(auction, now);
        assertBidAllowed(auction, bidderId, amountCents);

        previousHighestBidderId = auction.highestBidderId;
        const bid = await insertBid(tx, {
          auctionId,
          bidderId,
          amountCents,
          sequence: auction.bidCount + 1,
          placedAt: now,
        });
        const updated = await recordHighestBid(tx, auctionId, bid, now);
        return { bid, auction: updated };
      });

      const { bid, auction } = result;
      logger.info(
        { auctionId, bidId: bid.id, bidderId, amountCents, sequence: bid.sequence },
        'bid accepted',
      );

      // After COMMIT (CLAUDE.md). The bid is already stored, so a broker failure must not turn
      // into an error for the bidder. The lost event is a known limitation (docs/events.md §7).
      try {
        await publish('bid.placed', {
          bidId: bid.id,
          auctionId,
          title: auction.title,
          bidderId,
          amountCents,
          currency: auction.currency!,
          previousHighestBidderId,
          placedAt: bid.placedAt.toISOString(),
        });
      } catch (err) {
        logger.error({ err, auctionId, bidId: bid.id }, 'could not publish bid.placed');
      }
      return result;
    },

    async cancelAuction(auctionId, { cancelledBy, isAdmin }) {
      await withTransaction(pool, async (tx) => {
        const auction = await lockAuctionState(tx, auctionId);
        if (auction === null) {
          throw auctionNotFound();
        }
        // Cancelling twice gives the same answer, so auction-service can safely retry.
        if (auction.status === 'CANCELLED') {
          return;
        }
        const now = await currentTime(tx);
        if (auction.status !== 'OPEN' || now >= auction.endsAt!) {
          throw new ConflictError('AUCTION_CLOSED', 'This auction has ended');
        }
        if (auction.bidCount > 0 && !isAdmin) {
          throw new ConflictError('AUCTION_HAS_BIDS', 'This auction already has bids');
        }
        await markCancelled(tx, auctionId, cancelledBy, now);
      });
      logger.info({ auctionId, cancelledBy, isAdmin }, 'auction cancelled');
    },
  };
}
