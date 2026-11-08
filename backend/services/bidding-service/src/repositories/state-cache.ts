// Redis cache of each auction's live state (B-09). The database stays the source of truth: the
// cache only speeds up reads, and every failure (Redis down, slow, bad data) behaves like a miss.
import type { Logger } from '@auction/shared-common';
import type { AuctionState } from './bidding.repository';

/** The two Redis commands the cache uses. The real node-redis client fits this shape. */
export interface RedisClient {
  get(key: string): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface StateCache {
  /** The cached state, or null on a miss or any Redis problem. */
  get(auctionId: string): Promise<AuctionState | null>;
  /** Stores the state unless the cache already holds the same or a newer version. */
  put(state: AuctionState): Promise<void>;
}

export const stateKey = (auctionId: string) => `auction:${auctionId}:state`;

/**
 * Write only if newer. Two replicas can commit versions 5 and 6 and then write to Redis in the
 * opposite order; without this check the older state would win until the TTL runs out.
 * KEYS[1] = key, ARGV[1] = JSON, ARGV[2] = version, ARGV[3] = TTL in seconds.
 */
const PUT_IF_NEWER = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, cached = pcall(cjson.decode, current)
  if ok and tonumber(cached.version) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

const DATE_FIELDS = ['startsAt', 'endsAt', 'originalEndsAt'] as const;

/** Shared with the live channel (B-12): one JSON form of the state, dates as ISO strings. */
export function serialize(state: AuctionState): string {
  return JSON.stringify(state);
}

export function deserialize(text: string): AuctionState {
  const raw = JSON.parse(text) as Record<string, unknown>;
  for (const field of DATE_FIELDS) {
    raw[field] = raw[field] === null ? null : new Date(raw[field] as string);
  }
  return raw as unknown as AuctionState;
}

/** Bounds every Redis call, so a hanging Redis can never slow down a bid or a read. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createRedisStateCache(options: {
  client: RedisClient;
  ttlSeconds: number;
  logger: Logger;
  timeoutMs?: number;
}): StateCache {
  const { client, ttlSeconds, logger, timeoutMs = 200 } = options;

  return {
    async get(auctionId) {
      try {
        const text = await withTimeout(client.get(stateKey(auctionId)), timeoutMs);
        return typeof text === 'string' ? deserialize(text) : null;
      } catch (err) {
        logger.warn({ err, auctionId }, 'state cache read failed, using the database');
        return null;
      }
    },

    async put(state) {
      try {
        await withTimeout(
          client.eval(PUT_IF_NEWER, {
            keys: [stateKey(state.auctionId)],
            arguments: [serialize(state), String(state.version), String(ttlSeconds)],
          }),
          timeoutMs,
        );
      } catch (err) {
        // The TTL bounds how long an older entry can stay, so a failed write only costs freshness.
        logger.warn({ err, auctionId: state.auctionId }, 'state cache write failed');
      }
    },
  };
}

/** No cache at all: every read goes to the database. Used when Redis is not configured. */
export function createNoStateCache(): StateCache {
  return {
    get: async () => null,
    put: async () => {},
  };
}
