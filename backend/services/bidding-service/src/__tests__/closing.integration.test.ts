// Closing worker (B-11) against a real Postgres.
import { randomUUID } from 'node:crypto';
import { createLogger } from '@auction/shared-common';
import request from 'supertest';
import { startClosingWorker } from '../jobs/closing-worker';
import { BIDDER1_ID, BIDDER2_ID, SELLER_ID, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const placeBid = (auctionId: string, bidderId: string, amountCents: number) =>
  request(ctx.app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Authorization', `Bearer ${ctx.tokenFor(bidderId)}`)
    .send({ amountCents })
    .expect(201);

async function statusOf(auctionId: string) {
  const result = await ctx.pool.query<{ status: string; closed_at: Date | null }>(
    'SELECT status, closed_at FROM auction_state WHERE auction_id = $1',
    [auctionId],
  );
  return result.rows[0]!;
}

const closedEvents = () => ctx.published.filter((event) => event.type === 'auction.closed');

describe('results', () => {
  it('sells to the highest bidder when the reserve is met, and lists the losers', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, reservePriceCents: 1500 });
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await placeBid(auctionId, BIDDER2_ID, 1500);
    const thirdBidder = randomUUID();
    await placeBid(auctionId, thirdBidder, 1600);
    await placeBid(auctionId, BIDDER1_ID, 1700);
    await ctx.expireAuction(auctionId);

    expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(1);

    const state = await statusOf(auctionId);
    expect(state.status).toBe('CLOSED_SOLD');
    expect(closedEvents()).toHaveLength(1);
    const payload = closedEvents()[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      auctionId,
      sellerId: SELLER_ID,
      title: 'Test auction',
      currency: 'EUR',
      result: 'SOLD',
      winnerId: BIDDER1_ID,
      amountCents: 1700,
      closedAt: state.closed_at!.toISOString(),
    });
    // BIDDER1 bid twice but won, so only the other two lost.
    expect([...(payload.losingBidderIds as string[])].sort()).toEqual(
      [BIDDER2_ID, thirdBidder].sort(),
    );
  });

  it('sells when there is no reserve price', async () => {
    const auctionId = await ctx.addAuction({ reservePriceCents: null });
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await ctx.expireAuction(auctionId);

    await ctx.newClosingService().closeExpiredAuctions();

    expect(closedEvents()[0]!.payload).toMatchObject({
      result: 'SOLD',
      winnerId: BIDDER1_ID,
      losingBidderIds: [],
    });
  });

  it('sells when the highest bid equals the reserve exactly', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, reservePriceCents: 1000 });
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await ctx.expireAuction(auctionId);

    await ctx.newClosingService().closeExpiredAuctions();

    expect(closedEvents()[0]!.payload).toMatchObject({ result: 'SOLD', amountCents: 1000 });
  });

  it('closes without a sale when the reserve is not met, and every bidder lost', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, reservePriceCents: 5000 });
    await placeBid(auctionId, BIDDER1_ID, 1000);
    await placeBid(auctionId, BIDDER2_ID, 4900);
    await ctx.expireAuction(auctionId);

    await ctx.newClosingService().closeExpiredAuctions();

    expect((await statusOf(auctionId)).status).toBe('CLOSED_NO_SALE');
    const payload = closedEvents()[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ result: 'NO_SALE', noSaleReason: 'RESERVE_NOT_MET' });
    expect(payload).not.toHaveProperty('winnerId');
    expect([...(payload.losingBidderIds as string[])].sort()).toEqual(
      [BIDDER1_ID, BIDDER2_ID].sort(),
    );
  });

  it('closes without a sale when nobody bid', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);

    await ctx.newClosingService().closeExpiredAuctions();

    expect(closedEvents()[0]!.payload).toMatchObject({
      result: 'NO_SALE',
      noSaleReason: 'NO_BIDS',
      losingBidderIds: [],
    });
  });
});

describe('what the worker leaves alone', () => {
  it('does not close an auction that is still running', async () => {
    const auctionId = await ctx.addAuction({ endsInSeconds: 3600 });
    expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(0);
    expect((await statusOf(auctionId)).status).toBe('OPEN');
  });

  it('does not touch cancelled or already closed auctions, so it never closes twice', async () => {
    const cancelled = await ctx.addAuction();
    await request(ctx.app)
      .post(`/internal/auctions/${cancelled}/cancel`)
      .send({ cancelledBy: SELLER_ID, isAdmin: false })
      .expect(204);
    await ctx.pool.query(
      `UPDATE auction_state SET starts_at = now() - interval '2 min', ends_at = now() - interval '1 s',
         original_ends_at = now() - interval '1 s' WHERE auction_id = $1`,
      [cancelled],
    );
    const ended = await ctx.addAuction();
    await ctx.expireAuction(ended);

    const closing = ctx.newClosingService();
    expect(await closing.closeExpiredAuctions()).toBe(1);
    expect(await closing.closeExpiredAuctions()).toBe(0);
    expect((await statusOf(cancelled)).status).toBe('CANCELLED');
    expect(closedEvents()).toHaveLength(1);
  });

  it('refuses bids once the auction is closed', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);
    await ctx.newClosingService().closeExpiredAuctions();

    const res = await request(ctx.app)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
      .send({ amountCents: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_CLOSED');
  });

  it('keeps the auction closed when publishing fails', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);
    ctx.failNextPublish();

    expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(1);
    expect((await statusOf(auctionId)).status).toBe('CLOSED_NO_SALE');
  });
});

describe('two replicas', () => {
  it('skips an auction that another transaction holds, then closes it on the next round', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);
    const holder = await ctx.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM auction_state WHERE auction_id = $1 FOR UPDATE', [
        auctionId,
      ]);

      // Does not wait for the lock: SKIP LOCKED passes over the row at once.
      expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(0);
      expect((await statusOf(auctionId)).status).toBe('OPEN');

      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(1);
  });

  it('closes every auction exactly once when two workers run at the same time', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const auctionId = await ctx.addAuction();
      await ctx.expireAuction(auctionId);
      ids.push(auctionId);
    }
    const replicaA = ctx.newClosingService(5);
    const replicaB = ctx.newClosingService(5);

    let total = 0;
    for (;;) {
      const [a, b] = await Promise.all([
        replicaA.closeExpiredAuctions(),
        replicaB.closeExpiredAuctions(),
      ]);
      total += a + b;
      if (a === 0 && b === 0) {
        break;
      }
    }

    expect(total).toBe(30);
    const closedIds = closedEvents().map(
      (event) => (event.payload as { auctionId: string }).auctionId,
    );
    expect(closedIds).toHaveLength(30);
    expect(new Set(closedIds)).toEqual(new Set(ids));
  });
});

describe('the timer', () => {
  it('closes an ended auction by itself and stops cleanly', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);
    const worker = startClosingWorker({
      closingService: ctx.newClosingService(),
      intervalMs: 50,
      batchSize: 50,
      logger: createLogger({ service: 'closing-worker-test', level: 'silent' }),
    });
    try {
      for (let i = 0; i < 40 && (await statusOf(auctionId)).status === 'OPEN'; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect((await statusOf(auctionId)).status).toBe('CLOSED_NO_SALE');
    } finally {
      await worker.stop();
    }
  });
});
