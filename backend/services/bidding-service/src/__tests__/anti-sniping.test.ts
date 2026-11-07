// Anti-sniping (B-07): the rule on its own, and through POST /bids on a real Postgres.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { applyAntiSniping } from '../services/bidding.service';
import { ANTI_SNIPING, BIDDER1_ID, createTestContext, type TestContext } from './helpers';

describe('applyAntiSniping (pure rule)', () => {
  const now = new Date('2026-11-06T12:00:00.000Z');
  const endsIn = (seconds: number, extensionCount = 0) => ({
    endsAt: new Date(now.getTime() + seconds * 1000),
    extensionCount,
  });

  it('does nothing outside the window', () => {
    expect(applyAntiSniping(endsIn(31), now, ANTI_SNIPING)).toMatchObject({
      extended: false,
      extensionCount: 0,
      endsAt: endsIn(31).endsAt,
    });
  });

  it('extends exactly at the edge of the window', () => {
    expect(applyAntiSniping(endsIn(30), now, ANTI_SNIPING)).toMatchObject({
      extended: true,
      extensionCount: 1,
      endsAt: endsIn(60).endsAt,
    });
  });

  it('adds the extension to the current end, not to now', () => {
    expect(applyAntiSniping(endsIn(1), now, ANTI_SNIPING).endsAt).toEqual(endsIn(31).endsAt);
  });

  it('extends up to the maximum and then stops', () => {
    expect(applyAntiSniping(endsIn(5, 9), now, ANTI_SNIPING)).toMatchObject({
      extended: true,
      extensionCount: 10,
    });
    expect(applyAntiSniping(endsIn(5, 10), now, ANTI_SNIPING)).toMatchObject({
      extended: false,
      extensionCount: 10,
      endsAt: endsIn(5).endsAt,
    });
  });

  it('never extends when MAX_EXTENSIONS is 0', () => {
    const rules = { ...ANTI_SNIPING, maxExtensions: 0 };
    expect(applyAntiSniping(endsIn(5), now, rules).extended).toBe(false);
  });
});

describe('anti-sniping through the API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const placeBid = (auctionId: string, amountCents: number) =>
    request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(randomUUID())}`)
      .send({ amountCents });

  async function timingOf(auctionId: string) {
    const result = await ctx.pool.query<{
      ends_at: Date;
      original_ends_at: Date;
      extension_count: number;
    }>(
      'SELECT ends_at, original_ends_at, extension_count FROM auction_state WHERE auction_id = $1',
      [auctionId],
    );
    return result.rows[0]!;
  }

  it('extends the auction by 30 s for a bid in the last 30 s and publishes auction.extended', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 10 });
    const before = await timingOf(auctionId);

    const res = await placeBid(auctionId, 1000);

    expect(res.status).toBe(201);
    const after = await timingOf(auctionId);
    expect(after.extension_count).toBe(1);
    expect(after.ends_at.getTime() - before.ends_at.getTime()).toBe(30_000);
    expect(after.original_ends_at).toEqual(before.original_ends_at);
    expect(res.body.auction).toMatchObject({
      extensionCount: 1,
      endsAt: after.ends_at.toISOString(),
    });

    expect(ctx.published.map((event) => event.type)).toEqual(['bid.placed', 'auction.extended']);
    expect(ctx.published[1]!.payload).toEqual({
      auctionId,
      endsAt: after.ends_at.toISOString(),
      extensionCount: 1,
    });
  });

  it('does not extend or publish auction.extended for an early bid', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 3600 });
    const before = await timingOf(auctionId);

    await placeBid(auctionId, 1000).expect(201);

    expect(await timingOf(auctionId)).toEqual(before);
    expect(ctx.published.map((event) => event.type)).toEqual(['bid.placed']);
  });

  it('keeps extending with every late bid, up to MAX_EXTENSIONS', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 10 });
    // Pretend 9 extensions already happened, so only one is left.
    await ctx.pool.query(
      `UPDATE auction_state SET extension_count = 9, original_ends_at = ends_at - interval '270 s'
       WHERE auction_id = $1`,
      [auctionId],
    );

    await placeBid(auctionId, 1000).expect(201);
    const afterLast = await timingOf(auctionId);
    expect(afterLast.extension_count).toBe(10);

    // Move the end back into the window: the next bid must not extend any more.
    await ctx.pool.query(
      `UPDATE auction_state SET ends_at = now() + interval '10 s' WHERE auction_id = $1`,
      [auctionId],
    );
    const beforeCapped = await timingOf(auctionId);
    await placeBid(auctionId, 1100).expect(201);

    expect(await timingOf(auctionId)).toEqual(beforeCapped);
    expect(ctx.published.filter((event) => event.type === 'auction.extended')).toHaveLength(1);
  });

  it('keeps the bid when publishing auction.extended fails', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 10 });
    // The first publish (bid.placed) works; the broker "goes down" for auction.extended.
    const original = ctx.published.push.bind(ctx.published);
    let calls = 0;
    ctx.published.push = (...events) => {
      calls += 1;
      if (calls === 2) {
        throw new Error('broker is down');
      }
      return original(...events);
    };

    const res = await placeBid(auctionId, 1000);

    expect(res.status).toBe(201);
    expect((await timingOf(auctionId)).extension_count).toBe(1);
  });

  it('rejects a late bid with the same rules, and does not extend for it', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 10, startingPriceCents: 1000 });
    const before = await timingOf(auctionId);

    const res = await request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
      .send({ amountCents: 999 });

    expect(res.status).toBe(409);
    expect(await timingOf(auctionId)).toEqual(before);
  });
});
