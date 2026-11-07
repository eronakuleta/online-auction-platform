// Tasks A-18 and A-19: settlement after auction.closed, and GET /payments. Events are delivered by
// calling the same handler the RabbitMQ consumer calls, on a real Postgres built from
// database/payment.
import { randomUUID } from 'node:crypto';
import { createEvent } from '@auction/shared-common';
import request from 'supertest';
import { splitAmount } from '../services/settlement.service';
import {
  ADMIN_ID,
  BIDDER_ID,
  PLATFORM_WALLET_ID,
  SELLER_ID,
  createTestContext,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(() => {
  ctx.failPublishing(false);
});

afterAll(async () => {
  await ctx.close();
});

async function balance(walletOwner: { userId?: string; walletId?: string }): Promise<number> {
  const { rows } = await ctx.pool.query<{ balance_cents: string }>(
    walletOwner.walletId
      ? 'SELECT balance_cents FROM wallets WHERE id = $1'
      : 'SELECT balance_cents FROM wallets WHERE user_id = $1',
    [walletOwner.walletId ?? walletOwner.userId],
  );
  return rows[0] ? Number(rows[0].balance_cents) : NaN;
}

/** A user with a wallet holding exactly this much, so tests never depend on each other. */
async function userWith(cents: number): Promise<string> {
  const userId = randomUUID();
  const token = ctx.tokenFor(['BIDDER'], userId);
  await request(ctx.app)
    .get('/api/v1/wallet/me')
    .set({ Authorization: `Bearer ${token}` });
  if (cents > 0) {
    await request(ctx.app)
      .post('/api/v1/wallet/deposit')
      .set({ Authorization: `Bearer ${token}` })
      .send({ amountCents: cents })
      .expect(200);
  }
  return userId;
}

function sold(overrides: { winnerId: string; sellerId: string; amountCents: number }) {
  return createEvent('auction.closed', {
    auctionId: randomUUID(),
    title: 'Settled thing',
    currency: 'EUR',
    closedAt: new Date().toISOString(),
    losingBidderIds: [],
    result: 'SOLD',
    ...overrides,
  });
}

function eventsFor(auctionId: string) {
  return ctx.published.filter(
    (event) => (event.payload as { auctionId?: string }).auctionId === auctionId,
  );
}

async function settlementOf(auctionId: string) {
  const { rows } = await ctx.pool.query(
    'SELECT status, fee_cents, seller_cents, failure_reason FROM settlements WHERE auction_id = $1',
    [auctionId],
  );
  return rows;
}

describe('splitAmount (fee rounding, A-19)', () => {
  it.each([
    [10_000, 5, 500, 9_500],
    [1_999, 5, 99, 1_900], // 99.95 rounds down
    [19, 5, 0, 19], // a fee below one cent is 0
    [1, 5, 0, 1],
    [12_345, 0, 0, 12_345],
    [12_345, 100, 12_345, 0],
    [Number.MAX_SAFE_INTEGER, 5, 450_359_962_737_049, 8_556_839_292_003_942],
  ])('%i cents at %i%% gives fee %i and seller %i', (amount, percent, fee, seller) => {
    const split = splitAmount(amount, percent);
    expect(split).toEqual({ feeCents: fee, sellerCents: seller });
    expect(split.feeCents + split.sellerCents).toBe(amount);
  });
});

describe('consuming auction.closed', () => {
  it('moves the money in one go and publishes payment.completed', async () => {
    const winnerId = await userWith(50_000);
    const sellerId = await userWith(0);
    const platformBefore = await balance({ walletId: PLATFORM_WALLET_ID });
    const event = sold({ winnerId, sellerId, amountCents: 12_000 });

    await ctx.handlers['auction.closed'](event);

    expect(await balance({ userId: winnerId })).toBe(38_000);
    expect(await balance({ userId: sellerId })).toBe(11_400);
    expect(await balance({ walletId: PLATFORM_WALLET_ID })).toBe(platformBefore + 600);
    expect(await settlementOf(event.payload.auctionId)).toEqual([
      { status: 'COMPLETED', fee_cents: '600', seller_cents: '11400', failure_reason: null },
    ]);
    const published = eventsFor(event.payload.auctionId);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'payment.completed',
      payload: {
        auctionId: event.payload.auctionId,
        winnerId,
        sellerId,
        amountCents: 12_000,
        feeCents: 600,
        sellerCents: 11_400,
        currency: 'EUR',
        title: 'Settled thing',
      },
    });
  });

  it('writes one ledger row per change, each with the balance after it', async () => {
    const winnerId = await userWith(20_000);
    const sellerId = await userWith(0);
    const event = sold({ winnerId, sellerId, amountCents: 10_000 });

    await ctx.handlers['auction.closed'](event);

    const { rows } = await ctx.pool.query<{
      type: string;
      amount_cents: string;
      balance_after_cents: string;
    }>(
      `SELECT l.type, l.amount_cents, l.balance_after_cents
       FROM ledger_entries l JOIN settlements s ON s.id = l.settlement_id
       WHERE s.auction_id = $1 ORDER BY l.type`,
      [event.payload.auctionId],
    );
    expect(rows).toEqual([
      expect.objectContaining({ type: 'PLATFORM_FEE', amount_cents: '500' }),
      { type: 'SETTLEMENT_CREDIT', amount_cents: '9500', balance_after_cents: '9500' },
      { type: 'SETTLEMENT_DEBIT', amount_cents: '-10000', balance_after_cents: '10000' },
    ]);
  });

  it('writes no platform row when the fee rounds down to 0', async () => {
    const winnerId = await userWith(100);
    const sellerId = await userWith(0);
    const event = sold({ winnerId, sellerId, amountCents: 19 });

    await ctx.handlers['auction.closed'](event);

    expect(await balance({ userId: sellerId })).toBe(19);
    const { rows } = await ctx.pool.query(
      `SELECT l.type FROM ledger_entries l JOIN settlements s ON s.id = l.settlement_id
       WHERE s.auction_id = $1 ORDER BY l.type`,
      [event.payload.auctionId],
    );
    expect(rows.map((row) => row.type)).toEqual(['SETTLEMENT_CREDIT', 'SETTLEMENT_DEBIT']);
  });

  it('accepts a balance of exactly the amount, leaving 0', async () => {
    const winnerId = await userWith(7_777);
    const sellerId = await userWith(0);

    await ctx.handlers['auction.closed'](sold({ winnerId, sellerId, amountCents: 7_777 }));

    expect(await balance({ userId: winnerId })).toBe(0);
  });

  it('moves nothing without enough money, records the failure and publishes payment.failed', async () => {
    const winnerId = await userWith(5_000);
    const sellerId = await userWith(0);
    const platformBefore = await balance({ walletId: PLATFORM_WALLET_ID });
    const event = sold({ winnerId, sellerId, amountCents: 5_001 });

    await ctx.handlers['auction.closed'](event);

    expect(await balance({ userId: winnerId })).toBe(5_000);
    expect(await balance({ userId: sellerId })).toBe(0);
    expect(await balance({ walletId: PLATFORM_WALLET_ID })).toBe(platformBefore);
    expect(await settlementOf(event.payload.auctionId)).toEqual([
      {
        status: 'FAILED',
        fee_cents: null,
        seller_cents: null,
        failure_reason: 'INSUFFICIENT_FUNDS',
      },
    ]);
    expect(eventsFor(event.payload.auctionId)).toEqual([
      expect.objectContaining({
        type: 'payment.failed',
        payload: expect.objectContaining({ reason: 'INSUFFICIENT_FUNDS', amountCents: 5_001 }),
      }),
    ]);
  });

  it('fails with WALLET_NOT_FOUND when the winner has no wallet', async () => {
    const event = sold({ winnerId: randomUUID(), sellerId: SELLER_ID, amountCents: 100 });

    await ctx.handlers['auction.closed'](event);

    expect((await settlementOf(event.payload.auctionId))[0]).toMatchObject({
      status: 'FAILED',
      failure_reason: 'WALLET_NOT_FOUND',
    });
    expect(eventsFor(event.payload.auctionId)[0]?.payload).toMatchObject({
      reason: 'WALLET_NOT_FOUND',
    });
  });

  it('pays a seller whose wallet did not exist yet, creating it', async () => {
    const winnerId = await userWith(1_000);
    const sellerId = randomUUID();

    await ctx.handlers['auction.closed'](sold({ winnerId, sellerId, amountCents: 1_000 }));

    expect(await balance({ userId: sellerId })).toBe(950);
  });

  it('settles at most once when the same event comes again (A-19)', async () => {
    const winnerId = await userWith(30_000);
    const sellerId = await userWith(0);
    const event = sold({ winnerId, sellerId, amountCents: 10_000 });

    await ctx.handlers['auction.closed'](event);
    await ctx.handlers['auction.closed'](event);
    // A different event for the same auction is also refused: UNIQUE (auction_id) decides.
    await ctx.handlers['auction.closed'](createEvent('auction.closed', { ...event.payload }));

    expect(await balance({ userId: winnerId })).toBe(20_000);
    expect(await settlementOf(event.payload.auctionId)).toHaveLength(1);
    expect(eventsFor(event.payload.auctionId)).toHaveLength(1);
  });

  it('settles once when copies of the event arrive in parallel', async () => {
    const winnerId = await userWith(30_000);
    const sellerId = await userWith(0);
    const event = sold({ winnerId, sellerId, amountCents: 10_000 });

    await Promise.all(Array.from({ length: 5 }, () => ctx.handlers['auction.closed'](event)));

    expect(await balance({ userId: winnerId })).toBe(20_000);
    expect(await balance({ userId: sellerId })).toBe(9_500);
    expect(eventsFor(event.payload.auctionId)).toHaveLength(1);
  });

  it('a failed payment is final: a replay cannot succeed later (A-19)', async () => {
    const winnerId = await userWith(100);
    const sellerId = await userWith(0);
    const event = sold({ winnerId, sellerId, amountCents: 5_000 });
    await ctx.handlers['auction.closed'](event);

    // The winner deposits afterwards; the replayed event must still change nothing.
    await ctx.pool.query(
      `UPDATE wallets SET balance_cents = balance_cents + 10000 WHERE user_id = $1`,
      [winnerId],
    );
    await ctx.handlers['auction.closed'](event);

    expect(await settlementOf(event.payload.auctionId)).toEqual([
      expect.objectContaining({ status: 'FAILED' }),
    ]);
    expect(await balance({ userId: sellerId })).toBe(0);
  });

  it('settles different auctions of the same people in parallel without deadlock or loss', async () => {
    const winnerId = await userWith(10_000);
    const sellerId = await userWith(0);

    await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx.handlers['auction.closed'](sold({ winnerId, sellerId, amountCents: 1_000 })),
      ),
    );

    expect(await balance({ userId: winnerId })).toBe(2_000);
    expect(await balance({ userId: sellerId })).toBe(8 * 950);
  });

  it('does nothing for an auction without a sale', async () => {
    const event = createEvent('auction.closed', {
      auctionId: randomUUID(),
      sellerId: SELLER_ID,
      title: 'Nobody bid',
      currency: 'EUR',
      closedAt: new Date().toISOString(),
      losingBidderIds: [],
      result: 'NO_SALE',
      noSaleReason: 'NO_BIDS',
    });

    await ctx.handlers['auction.closed'](event);

    expect(await settlementOf(event.payload.auctionId)).toHaveLength(0);
    expect(eventsFor(event.payload.auctionId)).toHaveLength(0);
  });

  it('keeps the settlement when the broker is down: the money has moved', async () => {
    const winnerId = await userWith(2_000);
    const sellerId = await userWith(0);
    ctx.failPublishing(true);

    await expect(
      ctx.handlers['auction.closed'](sold({ winnerId, sellerId, amountCents: 2_000 })),
    ).resolves.toBeUndefined();

    expect(await balance({ userId: winnerId })).toBe(0);
  });

  it('refuses another currency, so the event is retried and then dead-lettered', async () => {
    const winnerId = await userWith(2_000);
    const event = createEvent('auction.closed', {
      ...sold({ winnerId, sellerId: SELLER_ID, amountCents: 100 }).payload,
      currency: 'USD',
    });

    await expect(ctx.handlers['auction.closed'](event)).rejects.toThrow(/USD/);
    expect(await settlementOf(event.payload.auctionId)).toHaveLength(0);
  });

  it('keeps every balance equal to the sum of its ledger rows', async () => {
    const { rows } = await ctx.pool.query(
      `SELECT w.id FROM wallets w LEFT JOIN ledger_entries l ON l.wallet_id = w.id
       GROUP BY w.id HAVING w.balance_cents <> COALESCE(sum(l.amount_cents), 0)`,
    );
    // The two rows changed by hand above (a manual top-up) are the only exception.
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe('GET /payments (ADMIN)', () => {
  const auth = (roles: ('ADMIN' | 'BIDDER' | 'SELLER')[], id = randomUUID()) => ({
    Authorization: `Bearer ${ctx.tokenFor(roles, id)}`,
  });

  it('lists every settlement, newest first, in the standard page shape', async () => {
    const response = await request(ctx.app)
      .get('/api/v1/payments?size=100')
      .set(auth(['ADMIN'], ADMIN_ID));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 100 });
    expect(response.body.total).toBeGreaterThan(5);
    const times = response.body.data.map((s: { createdAt: string }) => s.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), auctionId: expect.any(String) }),
    );
  });

  it('filters by status', async () => {
    const failed = await request(ctx.app)
      .get('/api/v1/payments?status=FAILED')
      .set(auth(['ADMIN']));

    expect(failed.status).toBe(200);
    expect(failed.body.data.every((s: { status: string }) => s.status === 'FAILED')).toBe(true);
    expect(failed.body.data[0]).toMatchObject({ feeCents: null, sellerCents: null });
  });

  it.each([['?status=PENDING'], ['?size=101'], ['?page=0'], ['?auctionId=x']])(
    'refuses %s with 400',
    async (query) => {
      const response = await request(ctx.app)
        .get(`/api/v1/payments${query}`)
        .set(auth(['ADMIN']));
      expect(response.status).toBe(400);
    },
  );

  it('answers 401 without a token and 403 for bidders and sellers', async () => {
    expect((await request(ctx.app).get('/api/v1/payments')).status).toBe(401);
    expect(
      (
        await request(ctx.app)
          .get('/api/v1/payments')
          .set(auth(['BIDDER'], BIDDER_ID))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .get('/api/v1/payments')
          .set(auth(['SELLER', 'BIDDER']))
      ).status,
    ).toBe(403);
  });
});
