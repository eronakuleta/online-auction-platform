// B-09: the Redis state cache, against a real Redis and a real Postgres. Skipped unless
// TEST_REDIS_URL is set (CI sets it). Uses Redis database 15, never the app's database 0.
import { randomUUID } from 'node:crypto';
import { createLogger } from '@auction/shared-common';
import { createClient } from 'redis';
import request from 'supertest';
import { findAuctionState } from '../repositories/bidding.repository';
import { createRedisStateCache, stateKey, type StateCache } from '../repositories/state-cache';
import { BIDDER1_ID, BIDDER2_ID, SELLER_ID, createTestContext, type TestContext } from './helpers';

const baseUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = baseUrl ? describe : describe.skip;
const logger = createLogger({ service: 'state-cache-test', level: 'silent' });

describeWithRedis('Redis state cache', () => {
  // Built even when the suite is skipped, so it must not depend on TEST_REDIS_URL being set.
  const url = `${(baseUrl ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/15`;
  const redis = createClient({ url, disableOfflineQueue: true });
  let ctx: TestContext;
  let cache: StateCache;

  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    await redis.close();
  });

  beforeEach(async () => {
    cache = createRedisStateCache({ client: redis, ttlSeconds: 30, logger });
    ctx = await createTestContext({ cache });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const placeBid = (auctionId: string, bidder: string, amountCents: number) =>
    request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(bidder)}`)
      .send({ amountCents })
      .expect(201);

  const cached = async (auctionId: string) => {
    const text = await redis.get(stateKey(auctionId));
    return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
  };

  it('writes the new state through to Redis after a bid, with a TTL', async () => {
    const auctionId = await ctx.addAuction();
    await placeBid(auctionId, BIDDER1_ID, 1000);

    expect(await cached(auctionId)).toMatchObject({
      auctionId,
      highestBidCents: 1000,
      highestBidderId: BIDDER1_ID,
      bidCount: 1,
      version: 1,
    });
    const ttl = await redis.ttl(stateKey(auctionId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('serves GET /state from the cache on a hit (cache-aside fills it on a miss)', async () => {
    const auctionId = await ctx.addAuction();
    const first = await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`).expect(200);
    expect(first.body.title).toBe('Test auction');
    expect(await cached(auctionId)).not.toBeNull();

    // Change the database behind the cache: a hit still shows the cached title.
    await ctx.pool.query(`UPDATE auction_state SET title = 'Changed' WHERE auction_id = $1`, [
      auctionId,
    ]);
    const second = await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`).expect(200);
    expect(second.body.title).toBe('Test auction');
    expect(second.body.endsAt).toBe(first.body.endsAt);
  });

  it('never replaces a newer cached version with an older one', async () => {
    const auctionId = await ctx.addAuction();
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await placeBid(auctionId, BIDDER2_ID, 1100);
    const newest = await findAuctionState(ctx.pool, auctionId);

    // A slow replica writes the state of version 1 after version 2 is already cached.
    await cache.put({ ...newest!, version: 1, highestBidCents: 1000, highestBidderId: BIDDER1_ID });

    expect(await cached(auctionId)).toMatchObject({ version: 2, highestBidCents: 1100 });
  });

  it('shows a cancel at once, even though the old open state was cached', async () => {
    const auctionId = await ctx.addAuction();
    await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`).expect(200);
    await request(ctx.app)
      .post(`/internal/auctions/${auctionId}/cancel`)
      .send({ cancelledBy: SELLER_ID, isAdmin: false })
      .expect(204);

    const res = await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('shows the closed result at once after the closing worker', async () => {
    const auctionId = await ctx.addAuction();
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await ctx.expireAuction(auctionId);
    await ctx.newClosingService().closeExpiredAuctions();

    expect(await cached(auctionId)).toMatchObject({ status: 'CLOSED_SOLD' });
    const res = await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`);
    expect(res.body.status).toBe('CLOSED_SOLD');
  });

  it('keeps dates as dates when reading back', async () => {
    const auctionId = await ctx.addAuction();
    const state = await findAuctionState(ctx.pool, auctionId);
    await cache.put(state!);
    const back = await cache.get(auctionId);
    expect(back!.endsAt).toEqual(state!.endsAt);
    expect(back!.endsAt).toBeInstanceOf(Date);
  });

  it('returns 404 for a cached cancelled placeholder, like the database path', async () => {
    const auctionId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO auction_state (auction_id, seller_id, title, status, cancelled_by, cancelled_at)
       VALUES ($1, $2, 'Lamp', 'CANCELLED', $2, now())`,
      [auctionId, SELLER_ID],
    );
    await cache.put((await findAuctionState(ctx.pool, auctionId))!);
    expect((await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`)).status).toBe(404);
  });
});

describe('when Redis is unreachable', () => {
  // Nothing listens on port 1: every command fails at once (no offline queue).
  const down = createClient({
    url: 'redis://127.0.0.1:1',
    disableOfflineQueue: true,
    socket: { reconnectStrategy: false },
  });
  down.on('error', () => {});
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({
      cache: createRedisStateCache({ client: down, ttlSeconds: 30, logger }),
    });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('still accepts bids and answers reads from the database', async () => {
    const auctionId = await ctx.addAuction();
    await request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
      .send({ amountCents: 1000 })
      .expect(201);
    const res = await request(ctx.app).get(`/api/v1/auctions/${auctionId}/state`).expect(200);
    expect(res.body.highestBidCents).toBe(1000);
  });
});
