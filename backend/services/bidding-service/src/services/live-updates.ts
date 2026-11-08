// Live updates for the SSE stream (B-12). After a committed change, the service hands the new state
// to LiveUpdates. With Redis, the state goes out on pub/sub and every replica (including this one)
// delivers it to its own viewers; without Redis, only this replica's viewers get it.
import type { Logger } from '@auction/shared-common';
import type { AuctionState } from '../repositories/bidding.repository';

export interface LiveUpdates {
  /** Never throws: a lost live update must not turn a committed bid into an error. */
  publish(state: AuctionState): Promise<void>;
}

/** Delivers to the viewers connected to this process. */
export type DeliverLocally = (state: AuctionState) => void;

/** Sends the state to every replica. Rejects if Redis cannot take it. */
export type PublishToReplicas = (state: AuctionState) => Promise<void>;

export function createLiveUpdates(options: {
  deliverLocally: DeliverLocally;
  publishToReplicas?: PublishToReplicas;
  logger: Logger;
}): LiveUpdates {
  const { deliverLocally, publishToReplicas, logger } = options;
  return {
    async publish(state) {
      if (publishToReplicas === undefined) {
        deliverLocally(state);
        return;
      }
      try {
        // This replica is subscribed too, so its own viewers get the state through Redis as well.
        await publishToReplicas(state);
      } catch (err) {
        // Redis is down: at least the viewers on this replica see the change.
        logger.warn({ err, auctionId: state.auctionId }, 'live update not sent to other replicas');
        deliverLocally(state);
      }
    },
  };
}
