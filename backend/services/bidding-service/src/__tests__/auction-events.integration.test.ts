// B-05: the auction snapshot built from auction.published and auction.cancelled, on a real Postgres.
import { randomUUID } from 'node:crypto';
import { createEvent, createLogger, type DomainEvent } from '@auction/shared-common';
import request from 'supertest';
import { createAuctionEventHandlers } from '../events/auction-events.consumer';
import { createNoStateCache } from '../repositories/state-cache';
import {
  BIDDER1_ID,
  LIVE_WITH_BIDS_ID,
  SELLER_ID,
  createTestContext,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let handlers: ReturnType<typeof createAuctionEventHandlers>;

beforeEach(async () => {
  ctx = await createTestContext();
  handlers = createAuctionEventHandlers({
    pool: ctx.pool,
    logger: createLogger({ service: 'auction-events-test', level: 'silent' }),
    cache: createNoStateCache(),
    live: ctx.live,
  });
});

afterEach(async () => {
  await ctx.close();
});

const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

function published(auctionId = randomUUID(), overrides: Record<string, unknown> = {}) {
  return createEvent('auction.published', {
    auctionId,
    sellerId: SELLER_ID,
    title: 'Event auction',
    startsAt: inSeconds(-60),
    endsAt: inSeconds(3600),
    startingPriceCents: 1500,
    minIncrementCents: 100,
    reservePriceCents: 3000,
    currency: 'EUR',
    ...overrides,
  }) as DomainEvent<'auction.published'>;
}

function cancelled(auctionId: string, cancelledBy = SELLER_ID) {
  return createEvent('auction.cancelled', {
    auctionId,
    sellerId: SELLER_ID,
    title: 'Event auction',
    cancelledBy,
  }) as DomainEvent<'auction.cancelled'>;
}

async function rowOf(auctionId: string) {
  const result = await ctx.pool.query<{
    status: string;
    title: string;
    starting_price_cents: string | null;
    reserve_price_cents: string | null;
    ends_at: Date | null;
    original_ends_at: Date | null;
    cancelled_by: string | null;
  }>(
    `SELECT status, title, starting_price_cents, reserve_price_cents, ends_at, original_ends_at,
       cancelled_by FROM auction_state WHERE auction_id = $1`,
    [auctionId],
  );
  return result.rows[0];
}

const bid = (auctionId: string, amountCents: number) =>
  request(ctx.app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
    .send({ amountCents });

describe('auction.published', () => {
  it('creates an open snapshot that accepts bids', async () => {
    const event = published();
    await handlers['auction.published']!(event);

    const row = await rowOf(event.payload.auctionId);
    expect(row).toMatchObject({
      status: 'OPEN',
      title: 'Event auction',
      starting_price_cents: '1500',
      reserve_price_cents: '3000',
    });
    expect(row!.ends_at!.toISOString()).toBe(event.payload.endsAt);
    expect(row!.original_ends_at).toEqual(row!.ends_at);

    const res = await bid(event.payload.auctionId, 1500);
    expect(res.status).toBe(201);
  });

  it('stores a missing reserve price as null', async () => {
    const event = published(randomUUID(), { reservePriceCents: null });
    await handlers['auction.published']!(event);
    expect((await rowOf(event.payload.auctionId))!.reserve_price_cents).toBeNull();
  });

  it('does nothing when the same event is delivered twice', async () => {
    const event = published();
    await handlers['auction.published']!(event);
    await bid(event.payload.auctionId, 1500).expect(201);

    await handlers['auction.published']!(event);

    const count = await ctx.pool.query(
      'SELECT count(*)::int AS n FROM bids WHERE auction_id = $1',
      [event.payload.auctionId],
    );
    expect(count.rows[0].n).toBe(1);
    const processed = await ctx.pool.query(
      'SELECT count(*)::int AS n FROM processed_events WHERE event_id = $1',
      [event.eventId],
    );
    expect(processed.rows[0].n).toBe(1);
  });

  it('never overwrites a known auction, even with a new event ID', async () => {
    const event = published(LIVE_WITH_BIDS_ID, { title: 'Changed title', startingPriceCents: 1 });
    await handlers['auction.published']!(event);
    expect((await rowOf(LIVE_WITH_BIDS_ID))!.title).toBe('Vintage 35mm film camera');
  });

  it('fails (so the consumer retries, then dead-letters) when the snapshot breaks a rule', async () => {
    const event = published(randomUUID(), { endsAt: inSeconds(-120) });
    await expect(handlers['auction.published']!(event)).rejects.toThrow();
    expect(await rowOf(event.payload.auctionId)).toBeUndefined();
    // Nothing was recorded, so a fixed redelivery would still be applied.
    const processed = await ctx.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [
      event.eventId,
    ]);
    expect(processed.rowCount).toBe(0);
  });
});

describe('auction.cancelled', () => {
  it('cancels an open auction, after which bids are refused', async () => {
    const event = published();
    await handlers['auction.published']!(event);
    await handlers['auction.cancelled']!(cancelled(event.payload.auctionId));

    expect(await rowOf(event.payload.auctionId)).toMatchObject({
      status: 'CANCELLED',
      cancelled_by: SELLER_ID,
    });
    const res = await bid(event.payload.auctionId, 1500);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_CANCELLED');
  });

  it('keeps a placeholder when it arrives before auction.published, which then cannot reopen it', async () => {
    const auctionId = randomUUID();
    await handlers['auction.cancelled']!(cancelled(auctionId));
    expect(await rowOf(auctionId)).toMatchObject({
      status: 'CANCELLED',
      starting_price_cents: null,
    });

    await handlers['auction.published']!(published(auctionId));

    expect((await rowOf(auctionId))!.status).toBe('CANCELLED');
    expect((await bid(auctionId, 1500)).status).toBe(404);
  });

  it('leaves an already cancelled auction as it was (internal call came first)', async () => {
    const event = published();
    await handlers['auction.published']!(event);
    await request(ctx.app)
      .post(`/internal/auctions/${event.payload.auctionId}/cancel`)
      .send({ cancelledBy: SELLER_ID, isAdmin: false })
      .expect(204);
    const adminId = randomUUID();

    await handlers['auction.cancelled']!(cancelled(event.payload.auctionId, adminId));

    expect((await rowOf(event.payload.auctionId))!.cancelled_by).toBe(SELLER_ID);
  });

  it('ignores a cancel for an auction that is already closed', async () => {
    const auctionId = await ctx.addAuction();
    await ctx.expireAuction(auctionId);
    await ctx.newClosingService().closeExpiredAuctions();

    await handlers['auction.cancelled']!(cancelled(auctionId));

    expect((await rowOf(auctionId))!.status).toBe('CLOSED_NO_SALE');
  });
});
