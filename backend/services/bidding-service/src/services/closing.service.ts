// Closing auctions whose end time has passed (B-11, ROADMAP §4 "Closing and settlement").
// No Express and no SQL here.
import type { EventPayload, Logger, Publish } from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction } from '../repositories/database';
import type { StateCache } from '../repositories/state-cache';
import { refreshCachedState } from './cache-refresh';
import type { LiveUpdates } from './live-updates';
import {
  listBidderIds,
  lockExpiredAuctions,
  markClosed,
  type AuctionState,
} from '../repositories/bidding.repository';

export interface ClosingDependencies {
  pool: Pool;
  publish: Publish;
  logger: Logger;
  /** How many auctions one transaction closes at most. */
  batchSize: number;
  cache: StateCache;
  live: LiveUpdates;
}

export interface ClosingService {
  /** Closes one batch of expired auctions and returns how many it closed. */
  closeExpiredAuctions(): Promise<number>;
}

export type AuctionResult =
  | { result: 'SOLD'; winnerId: string; amountCents: number }
  | { result: 'NO_SALE'; noSaleReason: 'NO_BIDS' | 'RESERVE_NOT_MET' };

/**
 * The winner is the highest bidder, unless there is no bid or the highest bid is below the
 * reserve price. The bid rules already guarantee the highest bid is at least the starting price.
 */
export function decideResult(auction: AuctionState): AuctionResult {
  if (auction.highestBidCents === null || auction.highestBidderId === null) {
    return { result: 'NO_SALE', noSaleReason: 'NO_BIDS' };
  }
  if (auction.reservePriceCents !== null && auction.highestBidCents < auction.reservePriceCents) {
    return { result: 'NO_SALE', noSaleReason: 'RESERVE_NOT_MET' };
  }
  return {
    result: 'SOLD',
    winnerId: auction.highestBidderId,
    amountCents: auction.highestBidCents,
  };
}

export function createClosingService(deps: ClosingDependencies): ClosingService {
  const { pool, publish, logger, batchSize, cache, live } = deps;

  return {
    async closeExpiredAuctions() {
      const events = await withTransaction(pool, async (tx) => {
        const expired = await lockExpiredAuctions(tx, batchSize);
        const payloads: EventPayload<'auction.closed'>[] = [];
        for (const auction of expired) {
          const outcome = decideResult(auction);
          const bidders = await listBidderIds(tx, auction.auctionId);
          const closedAt = await markClosed(
            tx,
            auction.auctionId,
            outcome.result === 'SOLD' ? 'CLOSED_SOLD' : 'CLOSED_NO_SALE',
          );
          payloads.push({
            auctionId: auction.auctionId,
            sellerId: auction.sellerId,
            title: auction.title,
            currency: auction.currency!,
            closedAt: closedAt.toISOString(),
            // Everyone who bid and did not win, so notification-service can tell them.
            losingBidderIds: bidders.filter(
              (bidderId) => outcome.result !== 'SOLD' || bidderId !== outcome.winnerId,
            ),
            ...outcome,
          });
        }
        return payloads;
      });

      // After COMMIT. A failed publish is logged and the auction stays closed; the lost event is a
      // known limitation without an outbox (docs/events.md §7).
      for (const payload of events) {
        await refreshCachedState(pool, cache, live, payload.auctionId);
        logger.info(
          {
            auctionId: payload.auctionId,
            result: payload.result,
            ...(payload.result === 'SOLD'
              ? { winnerId: payload.winnerId, amountCents: payload.amountCents }
              : { noSaleReason: payload.noSaleReason }),
          },
          'auction closed',
        );
        try {
          await publish('auction.closed', payload);
        } catch (err) {
          logger.error({ err, auctionId: payload.auctionId }, 'could not publish auction.closed');
        }
      }
      return events.length;
    },
  };
}
