// Task A-13: the events auction-service publishes, and what it does with the ones it consumes.
// Events are delivered by calling the same handlers the RabbitMQ consumer calls, on a real Postgres.
import { randomUUID } from 'node:crypto';
import { createEvent, type DomainEvent, type EventPayload } from '@auction/shared-common';
import request from 'supertest';
import { EventOutOfOrderError } from '../services/auction-event.service';
import { createTestContext, newAuction, type TestContext } from './helpers';

let ctx: TestContext;
let sellerId: string;
let sellerToken: string;
let adminId: string;
let adminToken: string;

const AUCTIONS = '/api/v1/auctions';

beforeAll(async () => {
  ctx = await createTestContext();
  sellerId = randomUUID();
  sellerToken = ctx.tokenFor(['BIDDER', 'SELLER'], sellerId);
  adminId = randomUUID();
  adminToken = ctx.tokenFor(['ADMIN'], adminId);
});

afterEach(() => {
  ctx.failPublishing(false);
  ctx.onPublish(undefined);
});

afterAll(async () => {
  await ctx.close();
});

function post(path: string, token: string) {
  return request(ctx.app)
    .post(path)
    .set({ Authorization: `Bearer ${token}` })
    .send();
}

async function createDraft(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(ctx.app)
    .post(AUCTIONS)
    .set({ Authorization: `Bearer ${sellerToken}` })
    .send(newAuction(overrides))
    .expect(201);
  return response.body.id as string;
}

async function createPublished(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await createDraft(overrides);
  await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(200);
  return id;
}

function eventsFor(auctionId: string): DomainEvent[] {
  return ctx.published.filter(
    (event) => (event.payload as { auctionId?: string }).auctionId === auctionId,
  );
}

interface AuctionRow {
  status: string;
  winner_id: string | null;
  final_price_cents: string | null;
  closed_at: Date | null;
  ends_at: Date;
}

async function rowOf(id: string): Promise<AuctionRow> {
  const { rows } = await ctx.pool.query<AuctionRow>(
    'SELECT status, winner_id, final_price_cents, closed_at, ends_at FROM auctions WHERE id = $1',
    [id],
  );
  if (!rows[0]) {
    throw new Error(`auction ${id} not found`);
  }
  return rows[0];
}

async function processedCount(eventId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ count: string }>(
    'SELECT count(*) FROM processed_events WHERE event_id = $1',
    [eventId],
  );
  return Number(rows[0]?.count);
}

// Events built with the shared createEvent, so they are checked against the contract like real ones.
function extended(auctionId: string, endsAt: Date) {
  return createEvent('auction.extended', {
    auctionId,
    endsAt: endsAt.toISOString(),
    extensionCount: 1,
  });
}

function closedSold(auctionId: string, winnerId = randomUUID(), amountCents = 4200) {
  return createEvent('auction.closed', {
    auctionId,
    sellerId,
    title: 'Test auction',
    currency: 'EUR',
    closedAt: '2026-11-10T12:00:00.000Z',
    losingBidderIds: [randomUUID()],
    result: 'SOLD',
    winnerId,
    amountCents,
  });
}

function closedNoSale(auctionId: string) {
  return createEvent('auction.closed', {
    auctionId,
    sellerId,
    title: 'Test auction',
    currency: 'EUR',
    closedAt: '2026-11-10T12:00:00.000Z',
    losingBidderIds: [],
    result: 'NO_SALE',
    noSaleReason: 'RESERVE_NOT_MET',
  });
}

function paymentCompleted(auctionId: string, winnerId: string) {
  return createEvent('payment.completed', {
    settlementId: randomUUID(),
    auctionId,
    title: 'Test auction',
    winnerId,
    sellerId,
    amountCents: 4200,
    feeCents: 210,
    sellerCents: 3990,
    currency: 'EUR',
    settledAt: '2026-11-10T12:00:05.000Z',
  });
}

function paymentFailed(auctionId: string, winnerId: string) {
  return createEvent('payment.failed', {
    auctionId,
    title: 'Test auction',
    winnerId,
    sellerId,
    amountCents: 4200,
    currency: 'EUR',
    reason: 'INSUFFICIENT_FUNDS',
    failedAt: '2026-11-10T12:00:05.000Z',
  });
}

/** A published auction that bidding-service has closed as sold. */
async function soldAuction(): Promise<{ id: string; winnerId: string }> {
  const id = await createPublished();
  const winnerId = randomUUID();
  await ctx.handlers['auction.closed'](closedSold(id, winnerId));
  return { id, winnerId };
}

describe('publishing auction.published', () => {
  it('publishes the terms bidding-service needs, exactly once, after a successful publish', async () => {
    const id = await createDraft({ reservePriceCents: 2500 });
    const response = await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(200);

    const events = eventsFor(id);
    expect(events).toHaveLength(1);
    const expected: EventPayload<'auction.published'> = {
      auctionId: id,
      sellerId,
      title: 'Test auction',
      startsAt: response.body.startsAt,
      endsAt: response.body.endsAt,
      startingPriceCents: 1000,
      minIncrementCents: 100,
      reservePriceCents: 2500,
      currency: 'EUR',
    };
    expect(events[0]).toMatchObject({ type: 'auction.published', version: 1, payload: expected });
  });

  it('sends null when there is no reserve price', async () => {
    const id = await createPublished({ reservePriceCents: null });

    expect(eventsFor(id)[0]?.payload).toMatchObject({ reservePriceCents: null });
  });

  it('publishes only after the commit: another connection already sees PUBLISHED', async () => {
    const id = await createDraft();
    let statusSeenByOthers: string | undefined;
    ctx.onPublish(async () => {
      statusSeenByOthers = (await rowOf(id)).status;
    });

    await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(200);

    expect(statusSeenByOthers).toBe('PUBLISHED');
  });

  it('publishes nothing when the publish is refused', async () => {
    const id = await createPublished();

    await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(409);
    await post(`${AUCTIONS}/${randomUUID()}/publish`, sellerToken).expect(404);

    expect(eventsFor(id)).toHaveLength(1);
  });

  it('still answers 200 when the broker is down, because the auction is already published', async () => {
    const id = await createDraft();
    ctx.failPublishing(true);

    const response = await post(`${AUCTIONS}/${id}/publish`, sellerToken);

    expect(response.status).toBe(200);
    expect((await rowOf(id)).status).toBe('PUBLISHED');
    expect(eventsFor(id)).toHaveLength(0);
  });
});

describe('publishing auction.cancelled', () => {
  it('publishes who cancelled a published auction', async () => {
    const id = await createPublished();

    await post(`${AUCTIONS}/${id}/cancel`, adminToken).expect(200);

    const cancelled = eventsFor(id).filter((event) => event.type === 'auction.cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.payload).toEqual({
      auctionId: id,
      sellerId,
      title: 'Test auction',
      cancelledBy: adminId,
    });
  });

  it('publishes nothing for a draft, which nobody else has seen', async () => {
    const id = await createDraft();

    await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(200);

    expect(eventsFor(id)).toHaveLength(0);
  });

  it('publishes nothing when bidding-service refuses the cancel', async () => {
    const id = await createPublished();
    ctx.answerNextCancel({
      status: 409,
      body: { error: { code: 'AUCTION_HAS_BIDS', message: 'has bids', details: [] } },
    });

    await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(409);

    expect(eventsFor(id).map((event) => event.type)).toEqual(['auction.published']);
    expect((await rowOf(id)).status).toBe('PUBLISHED');
  });

  it('still answers 200 when the broker is down', async () => {
    const id = await createPublished();
    ctx.failPublishing(true);

    await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(200);

    expect((await rowOf(id)).status).toBe('CANCELLED');
  });
});

describe('consuming auction.extended', () => {
  it('moves the end time later, and the catalog shows it', async () => {
    const id = await createPublished();
    const later = new Date((await rowOf(id)).ends_at.getTime() + 120_000);

    await ctx.handlers['auction.extended'](extended(id, later));

    expect((await rowOf(id)).ends_at).toEqual(later);
    const detail = await request(ctx.app).get(`${AUCTIONS}/${id}`).expect(200);
    expect(detail.body.endsAt).toBe(later.toISOString());
  });

  it('never moves the end time earlier, so an old retried event cannot shorten an auction', async () => {
    const id = await createPublished();
    const { ends_at: endsAt } = await rowOf(id);

    await ctx.handlers['auction.extended'](extended(id, new Date(endsAt.getTime() - 60_000)));

    expect((await rowOf(id)).ends_at).toEqual(endsAt);
  });

  it('ignores an extension that arrives after the auction closed', async () => {
    const { id } = await soldAuction();
    const { ends_at: endsAt } = await rowOf(id);
    const event = extended(id, new Date(endsAt.getTime() + 60_000));

    await ctx.handlers['auction.extended'](event);

    expect((await rowOf(id)).ends_at).toEqual(endsAt);
    // Recorded, so a redelivery is skipped without looking again.
    expect(await processedCount(event.eventId)).toBe(1);
  });
});

describe('consuming auction.closed', () => {
  it('records a sale: winner, price and closing time', async () => {
    const id = await createPublished();
    const winnerId = randomUUID();

    await ctx.handlers['auction.closed'](closedSold(id, winnerId, 4200));

    expect(await rowOf(id)).toMatchObject({
      status: 'CLOSED_SOLD',
      winner_id: winnerId,
      final_price_cents: '4200',
      closed_at: new Date('2026-11-10T12:00:00.000Z'),
    });
  });

  it('records no sale without a winner or price', async () => {
    const id = await createPublished();

    await ctx.handlers['auction.closed'](closedNoSale(id));

    expect(await rowOf(id)).toMatchObject({
      status: 'CLOSED_NO_SALE',
      winner_id: null,
      final_price_cents: null,
      closed_at: new Date('2026-11-10T12:00:00.000Z'),
    });
  });

  it.each([
    ['a cancelled', 'CANCELLED'],
    ['an already closed', 'CLOSED_NO_SALE'],
    ['a draft', 'DRAFT'],
  ])('ignores closing %s auction', async (_label, status) => {
    const id = await createDraft();
    if (status === 'CANCELLED') {
      await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(200);
    }
    if (status === 'CLOSED_NO_SALE') {
      await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(200);
      await ctx.handlers['auction.closed'](closedNoSale(id));
    }

    await ctx.handlers['auction.closed'](closedSold(id));

    expect(await rowOf(id)).toMatchObject({ status, winner_id: null });
  });

  it('applies a redelivered event only once', async () => {
    const id = await createPublished();
    const event = closedSold(id);
    await ctx.handlers['auction.closed'](event);
    // Put the row back, so a second application would be visible.
    await ctx.pool.query(
      `UPDATE auctions SET status = 'PUBLISHED', winner_id = NULL, final_price_cents = NULL,
              closed_at = NULL WHERE id = $1`,
      [id],
    );

    await ctx.handlers['auction.closed'](event);

    expect((await rowOf(id)).status).toBe('PUBLISHED');
    expect(await processedCount(event.eventId)).toBe(1);
  });

  it('handles parallel copies of the same event once, without errors', async () => {
    const id = await createPublished();
    const event = closedSold(id);

    await Promise.all(Array.from({ length: 5 }, () => ctx.handlers['auction.closed'](event)));

    expect((await rowOf(id)).status).toBe('CLOSED_SOLD');
    expect(await processedCount(event.eventId)).toBe(1);
  });

  it('ignores an event for an auction this service does not know', async () => {
    const event = closedNoSale(randomUUID());

    await expect(ctx.handlers['auction.closed'](event)).resolves.toBeUndefined();
  });
});

describe('consuming payment.completed and payment.failed', () => {
  it('marks a sold auction SETTLED', async () => {
    const { id, winnerId } = await soldAuction();

    await ctx.handlers['payment.completed'](paymentCompleted(id, winnerId));

    expect(await rowOf(id)).toMatchObject({ status: 'SETTLED', winner_id: winnerId });
  });

  it('marks a sold auction PAYMENT_FAILED', async () => {
    const { id, winnerId } = await soldAuction();

    await ctx.handlers['payment.failed'](paymentFailed(id, winnerId));

    expect(await rowOf(id)).toMatchObject({ status: 'PAYMENT_FAILED', winner_id: winnerId });
  });

  it('fails a payment that overtook auction.closed, so it is retried, and the retry works', async () => {
    const id = await createPublished();
    const winnerId = randomUUID();
    const payment = paymentCompleted(id, winnerId);

    await expect(ctx.handlers['payment.completed'](payment)).rejects.toThrow(EventOutOfOrderError);
    expect((await rowOf(id)).status).toBe('PUBLISHED');
    // Rolled back, so the retry is not mistaken for a duplicate.
    expect(await processedCount(payment.eventId)).toBe(0);

    await ctx.handlers['auction.closed'](closedSold(id, winnerId));
    await ctx.handlers['payment.completed'](payment);

    expect((await rowOf(id)).status).toBe('SETTLED');
  });

  it('ignores a payment for an auction that was not sold', async () => {
    const id = await createPublished();
    await ctx.handlers['auction.closed'](closedNoSale(id));

    await ctx.handlers['payment.completed'](paymentCompleted(id, randomUUID()));

    expect((await rowOf(id)).status).toBe('CLOSED_NO_SALE');
  });

  it('never changes a final payment result', async () => {
    const { id, winnerId } = await soldAuction();
    await ctx.handlers['payment.completed'](paymentCompleted(id, winnerId));

    await ctx.handlers['payment.failed'](paymentFailed(id, winnerId));

    expect((await rowOf(id)).status).toBe('SETTLED');
  });
});
