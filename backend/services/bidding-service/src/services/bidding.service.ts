// Business rules for bids (ROADMAP §4, CLAUDE.md "Place bid"). No Express and no SQL here.
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Logger,
  type Publish,
} from '@auction/shared-common';
import type { Pool } from 'pg';
import type { PaymentClient } from '../clients/payment.client';
import type { StateCache } from '../repositories/state-cache';
import { refreshCachedState } from './cache-refresh';
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

/** SNIPE_WINDOW_SECONDS, SNIPE_EXTENSION_SECONDS and MAX_EXTENSIONS from the environment. */
export interface AntiSnipingRules {
  windowSeconds: number;
  extensionSeconds: number;
  maxExtensions: number;
}

export interface BiddingDependencies {
  pool: Pool;
  publish: Publish;
  logger: Logger;
  antiSniping: AntiSnipingRules;
  payment: PaymentClient;
  cache: StateCache;
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

/**
 * Anti-sniping (ROADMAP §4 rule 7): a bid that arrives within the window before the end pushes
 * the end back by the extension, at most maxExtensions times. Without it, a bidder could wait for
 * the last second so nobody has time to answer.
 */
export function applyAntiSniping(
  auction: { endsAt: Date; extensionCount: number },
  now: Date,
  rules: AntiSnipingRules,
): { endsAt: Date; extensionCount: number; extended: boolean } {
  const remainingMs = auction.endsAt.getTime() - now.getTime();
  const inWindow = remainingMs <= rules.windowSeconds * 1000;
  if (!inWindow || auction.extensionCount >= rules.maxExtensions) {
    return { endsAt: auction.endsAt, extensionCount: auction.extensionCount, extended: false };
  }
  return {
    endsAt: new Date(auction.endsAt.getTime() + rules.extensionSeconds * 1000),
    extensionCount: auction.extensionCount + 1,
    extended: true,
  };
}

export function createBiddingService(deps: BiddingDependencies): BiddingService {
  const { pool, publish, logger, antiSniping, payment, cache } = deps;

  return {
    async placeBid(bidderId, auctionId, amountCents) {
      // Before the transaction, so the row lock is never held during a network call (CLAUDE.md).
      // Funds are checked, not reserved: a known limitation (ROADMAP §2, payment.failed handles it).
      const funds = await payment.checkFunds(bidderId, amountCents);
      if (funds !== 'SUFFICIENT') {
        throw new ConflictError(
          'INSUFFICIENT_FUNDS',
          funds === 'NO_WALLET'
            ? 'You have no wallet yet. Deposit money before bidding'
            : 'Your wallet balance does not cover this bid',
        );
      }

      let previousHighestBidderId: string | null = null;
      let extended = false;

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
        const timing = applyAntiSniping(
          { endsAt: auction.endsAt!, extensionCount: auction.extensionCount },
          now,
          antiSniping,
        );
        extended = timing.extended;
        const updated = await recordHighestBid(tx, auctionId, bid, {
          extendBySeconds: timing.extended ? antiSniping.extensionSeconds : 0,
          updatedAt: now,
        });
        return { bid, auction: updated };
      });

      const { bid, auction } = result;
      // Write-through after COMMIT: readers see the new highest bid without asking the database.
      await cache.put(auction);
      logger.info(
        { auctionId, bidId: bid.id, bidderId, amountCents, sequence: bid.sequence, extended },
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
      // auction-service updates the endsAt it shows in the catalog (A-13).
      if (extended) {
        try {
          await publish('auction.extended', {
            auctionId,
            endsAt: auction.endsAt!.toISOString(),
            extensionCount: auction.extensionCount,
          });
        } catch (err) {
          logger.error({ err, auctionId }, 'could not publish auction.extended');
        }
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
      await refreshCachedState(pool, cache, auctionId);
      logger.info({ auctionId, cancelledBy, isAdmin }, 'auction cancelled');
    },
  };
}
