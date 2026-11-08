// Redis pub/sub for live updates across bidding replicas (B-12). One pattern subscription per
// replica receives every auction's updates; the stream hub keeps only those someone is watching.
import type { AuctionState } from './bidding.repository';
import { deserialize, serialize } from './state-cache';

export const liveChannel = (auctionId: string) => `auction:${auctionId}:live`;
const LIVE_PATTERN = 'auction:*:live';

/** The publishing side; the same node-redis client as the cache fits this shape. */
export interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/** A dedicated connection: in subscribe mode Redis allows no other commands on it. */
export interface RedisSubscriber {
  pSubscribe(pattern: string, listener: (message: string) => void): Promise<unknown>;
}

export function createReplicaPublisher(client: RedisPublisher, timeoutMs = 200) {
  return async (state: AuctionState): Promise<void> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis publish timed out')), timeoutMs);
    });
    try {
      await Promise.race([client.publish(liveChannel(state.auctionId), serialize(state)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function subscribeToLiveUpdates(
  subscriber: RedisSubscriber,
  onState: (state: AuctionState) => void,
  onBadMessage: (err: unknown) => void,
): Promise<void> {
  await subscriber.pSubscribe(LIVE_PATTERN, (message) => {
    try {
      onState(deserialize(message));
    } catch (err) {
      onBadMessage(err);
    }
  });
}
