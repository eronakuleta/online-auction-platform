import type { DomainEvent, Logger } from '@auction/shared-common';
import type { Pool, PoolClient } from 'pg';
import {
  extendAuctionEnd,
  findAuctionForUpdate,
  markAuctionClosed,
  markAuctionPayment,
  type Auction,
} from '../repositories/auction.repository';
import { withTransaction } from '../repositories/database';
import { markEventProcessed } from '../repositories/processed-event.repository';
import { canMoveTo } from './auction-states';

// What auction-service does with the events it consumes (docs/events.md §3 and §7). bidding-service
// decides when an auction closes and payment-service decides how it is paid; this service only
// records those results, so the catalog shows the right status.

export interface AuctionEventServiceDependencies {
  pool: Pool;
  logger: Logger;
}

/** Thrown when an event came too early. The consumer then retries it a few seconds later. */
export class EventOutOfOrderError extends Error {}

export function createAuctionEventService(deps: AuctionEventServiceDependencies) {
  const { pool, logger } = deps;

  /**
   * Applies an event at most once. Its ID is recorded in the same transaction as its effect, so a
   * redelivered event is skipped, and an effect that fails leaves no record and can be retried.
   * The auction row is locked, so an event and a seller's cancel never interleave.
   */
  async function applyOnce(
    event: DomainEvent,
    auctionId: string,
    apply: (transaction: PoolClient, auction: Auction) => Promise<void>,
  ): Promise<void> {
    const fields = { eventId: event.eventId, eventType: event.type, auctionId };
    await withTransaction(pool, async (transaction) => {
      if (!(await markEventProcessed(transaction, event.eventId, event.type))) {
        logger.info(fields, 'duplicate event skipped');
        return;
      }
      const auction = await findAuctionForUpdate(transaction, auctionId);
      if (!auction) {
        // This service creates every auction, so a retry would not help.
        logger.warn(fields, 'event for an unknown auction ignored');
        return;
      }
      await apply(transaction, auction);
    });
  }

  /**
   * Events can arrive late or out of order (a retry overtakes newer events). One that is not a
   * valid change from the current status is recorded and ignored, as docs/events.md §7 says.
   */
  function ignore(event: DomainEvent, auction: Auction, reason: string): void {
    logger.warn(
      {
        eventId: event.eventId,
        eventType: event.type,
        auctionId: auction.id,
        status: auction.status,
      },
      `event ignored: ${reason}`,
    );
  }

  return {
    /** Anti-sniping moved the end time. Only an open auction can be extended. */
    async applyExtension(event: DomainEvent<'auction.extended'>): Promise<void> {
      const { auctionId, endsAt, extensionCount } = event.payload;
      await applyOnce(event, auctionId, async (transaction, auction) => {
        if (auction.status !== 'PUBLISHED') {
          ignore(event, auction, 'only a published auction can be extended');
          return;
        }
        await extendAuctionEnd(transaction, auctionId, new Date(endsAt));
        logger.info({ auctionId, endsAt, extensionCount }, 'auction end extended');
      });
    },

    /** bidding-service closed the auction: sold to the highest bidder, or no sale. */
    async applyClosing(event: DomainEvent<'auction.closed'>): Promise<void> {
      const { payload } = event;
      const target = payload.result === 'SOLD' ? 'CLOSED_SOLD' : 'CLOSED_NO_SALE';
      await applyOnce(event, payload.auctionId, async (transaction, auction) => {
        if (!canMoveTo(auction.status, target)) {
          ignore(event, auction, `cannot move from ${auction.status} to ${target}`);
          return;
        }
        const closedAt = new Date(payload.closedAt);
        await markAuctionClosed(
          transaction,
          auction.id,
          payload.result === 'SOLD'
            ? {
                status: 'CLOSED_SOLD',
                winnerId: payload.winnerId,
                finalPriceCents: payload.amountCents,
                closedAt,
              }
            : { status: 'CLOSED_NO_SALE', closedAt },
        );
        logger.info({ auctionId: auction.id, status: target }, 'auction closed');
      });
    },

    /** payment-service settled the sale (SETTLED), or could not take the money (PAYMENT_FAILED). */
    async applyPayment(
      event: DomainEvent<'payment.completed' | 'payment.failed'>,
      target: 'SETTLED' | 'PAYMENT_FAILED',
    ): Promise<void> {
      await applyOnce(event, event.payload.auctionId, async (transaction, auction) => {
        // Payment follows auction.closed, but a retried auction.closed can arrive after it. Ignoring
        // the payment would lose it for good, so it fails and the consumer retries it in 5 s. The
        // rollback also removes its processed_events row, so the retry is not seen as a duplicate.
        if (auction.status === 'PUBLISHED') {
          throw new EventOutOfOrderError(`${event.type} arrived before auction.closed`);
        }
        if (!canMoveTo(auction.status, target)) {
          ignore(event, auction, `cannot move from ${auction.status} to ${target}`);
          return;
        }
        await markAuctionPayment(transaction, auction.id, target);
        logger.info({ auctionId: auction.id, status: target }, 'auction payment recorded');
      });
    },
  };
}

export type AuctionEventService = ReturnType<typeof createAuctionEventService>;
