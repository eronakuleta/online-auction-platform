// Builds the local auction snapshot from auction-service's events (B-05, docs/events.md §3 and §7).
// Each handler records the event ID in the same transaction as its effect, so a redelivered event
// changes nothing. A handler that throws is retried by the shared consumer, then dead-lettered.
import type { EventHandlers, Logger } from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction } from '../repositories/database';
import type { StateCache } from '../repositories/state-cache';
import { refreshCachedState } from '../services/cache-refresh';
import {
  cancelFromEvent,
  insertSnapshot,
  markEventProcessed,
} from '../repositories/bidding.repository';

export function createAuctionEventHandlers(deps: {
  pool: Pool;
  logger: Logger;
  cache: StateCache;
}): EventHandlers<'bidding-service'> {
  const { pool, logger, cache } = deps;

  return {
    async 'auction.published'(event) {
      const { payload } = event;
      const outcome = await withTransaction(pool, async (tx) => {
        if (!(await markEventProcessed(tx, event.eventId, event.type))) {
          return 'duplicate event';
        }
        return (await insertSnapshot(tx, payload)) ? 'snapshot created' : 'already known';
      });
      await refreshCachedState(pool, cache, payload.auctionId);
      logger.info(
        { eventId: event.eventId, auctionId: payload.auctionId, outcome },
        'auction.published handled',
      );
    },

    async 'auction.cancelled'(event) {
      const { payload } = event;
      const outcome = await withTransaction(pool, async (tx) => {
        if (!(await markEventProcessed(tx, event.eventId, event.type))) {
          return 'duplicate event';
        }
        return `status ${await cancelFromEvent(tx, payload)}`;
      });
      await refreshCachedState(pool, cache, payload.auctionId);
      logger.info(
        { eventId: event.eventId, auctionId: payload.auctionId, outcome },
        'auction.cancelled handled',
      );
    },
  };
}
