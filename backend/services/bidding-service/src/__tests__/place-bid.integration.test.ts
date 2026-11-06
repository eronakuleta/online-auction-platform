// POST /api/v1/auctions/:id/bids against a real Postgres (B-06).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  BIDDER1_ID,
  BIDDER2_ID,
  CLOSED_ID,
  LIVE_NO_BIDS_ID,
  LIVE_WITH_BIDS_ID,
  SELLER_ID,
  UPCOMING_ID,
  createTestContext,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const bid = (auctionId: string, token: string | undefined, body: unknown) => {
  const req = request(ctx.app).post(`/api/v1/auctions/${auctionId}/bids`);
  return (token === undefined ? req : req.set('Authorization', `Bearer ${token}`)).send(
    body as object,
  );
};

async function stateOf(auctionId: string) {
  const result = await ctx.pool.query<{
    highest_bid_cents: string | null;
    highest_bidder_id: string | null;
    bid_count: number;
    version: string;
  }>(
    'SELECT highest_bid_cents, highest_bidder_id, bid_count, version FROM auction_state WHERE auction_id = $1',
    [auctionId],
  );
  return result.rows[0]!;
}

describe('successful bids', () => {
  it('accepts a first bid at exactly the starting price', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 2000 });

    expect(res.status).toBe(201);
    expect(res.body.bid).toMatchObject({
      auctionId: LIVE_NO_BIDS_ID,
      bidderId: BIDDER1_ID,
      amountCents: 2000,
      sequence: 1,
    });
    expect(res.body.auction).toMatchObject({
      highestBidCents: 2000,
      highestBidderId: BIDDER1_ID,
      bidCount: 1,
      minimumNextBidCents: 2200,
      version: 1,
    });
    expect(res.body.auction).not.toHaveProperty('reservePriceCents');
    expect(await stateOf(LIVE_NO_BIDS_ID)).toMatchObject({
      highest_bid_cents: '2000',
      highest_bidder_id: BIDDER1_ID,
      bid_count: 1,
    });
  });

  it('accepts a bid of exactly highest + increment and outbids the previous bidder', async () => {
    const res = await bid(LIVE_WITH_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 6000 });

    expect(res.status).toBe(201);
    expect(res.body.bid.sequence).toBe(3);
    expect(res.body.auction.highestBidderId).toBe(BIDDER1_ID);
  });

  it('publishes bid.placed after the commit, naming who was outbid', async () => {
    await bid(LIVE_WITH_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 6000 });

    expect(ctx.published).toHaveLength(1);
    expect(ctx.published[0]).toMatchObject({
      type: 'bid.placed',
      payload: {
        auctionId: LIVE_WITH_BIDS_ID,
        bidderId: BIDDER1_ID,
        amountCents: 6000,
        currency: 'EUR',
        title: 'Vintage 35mm film camera',
        previousHighestBidderId: BIDDER2_ID,
      },
    });
  });

  it('sends previousHighestBidderId null on the first bid', async () => {
    await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 2000 });
    expect(ctx.published[0]!.payload).toMatchObject({ previousHighestBidderId: null });
  });

  it('keeps the bid when the broker is down', async () => {
    ctx.failNextPublish();
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 2000 });

    expect(res.status).toBe(201);
    expect((await stateOf(LIVE_NO_BIDS_ID)).bid_count).toBe(1);
  });

  it('lets a seller who also has BIDDER bid on someone else’s auction', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(randomUUID(), ['SELLER', 'BIDDER']), {
      amountCents: 2000,
    });
    expect(res.status).toBe(201);
  });
});

describe('validation (400)', () => {
  const token = () => ctx.tokenFor(BIDDER1_ID);

  it.each([
    ['a float', { amountCents: 2000.5 }],
    ['zero', { amountCents: 0 }],
    ['a negative amount', { amountCents: -2000 }],
    ['a string', { amountCents: '2000' }],
    ['a missing amount', {}],
    ['an unknown field', { amountCents: 2000, bidderId: BIDDER2_ID }],
    ['an unsafe integer', { amountCents: 2 ** 53 }],
  ])('rejects %s', async (_name, body) => {
    const res = await bid(LIVE_NO_BIDS_ID, token(), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await stateOf(LIVE_NO_BIDS_ID)).bid_count).toBe(0);
  });

  it('rejects an auction id that is not a UUID', async () => {
    const res = await bid('not-a-uuid', token(), { amountCents: 2000 });
    expect(res.status).toBe(400);
  });
});

describe('authentication and roles', () => {
  it('returns 401 without a token', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, undefined, { amountCents: 2000 });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a forged token', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, 'abc.def.ghi', { amountCents: 2000 });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a user without the BIDDER role', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(randomUUID(), ['SELLER']), {
      amountCents: 2000,
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 OWN_AUCTION when the seller bids on their own auction', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(SELLER_ID, ['SELLER', 'BIDDER']), {
      amountCents: 2000,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OWN_AUCTION');
  });
});

describe('business rules', () => {
  it('returns 404 for an unknown auction', async () => {
    const res = await bid(randomUUID(), ctx.tokenFor(BIDDER1_ID), { amountCents: 2000 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AUCTION_NOT_FOUND');
  });

  it('returns 409 BID_TOO_LOW one cent below the starting price', async () => {
    const res = await bid(LIVE_NO_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 1999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'BID_TOO_LOW',
      message: 'Bid must be at least 2000',
    });
  });

  it('returns 409 BID_TOO_LOW one cent below highest + increment', async () => {
    const res = await bid(LIVE_WITH_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 5999 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BID_TOO_LOW');
  });

  it('returns 409 ALREADY_HIGHEST_BIDDER when outbidding yourself', async () => {
    const res = await bid(LIVE_WITH_BIDS_ID, ctx.tokenFor(BIDDER2_ID), { amountCents: 7000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_HIGHEST_BIDDER');
  });

  it('returns 409 AUCTION_NOT_STARTED before starts_at', async () => {
    const res = await bid(UPCOMING_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 15000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_NOT_STARTED');
  });

  it('returns 409 AUCTION_CLOSED for a closed auction', async () => {
    const res = await bid(CLOSED_ID, ctx.tokenFor(BIDDER2_ID), { amountCents: 50000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_CLOSED');
  });

  it('returns 409 AUCTION_CLOSED once ends_at has passed, before the worker closes it', async () => {
    const auctionId = await ctx.addAuction({ startsInSeconds: -120, endsInSeconds: -1 });
    const res = await bid(auctionId, ctx.tokenFor(BIDDER1_ID), { amountCents: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_CLOSED');
  });

  it('returns 409 AUCTION_CANCELLED for a cancelled auction', async () => {
    const auctionId = await ctx.addAuction();
    await request(ctx.app)
      .post(`/internal/auctions/${auctionId}/cancel`)
      .send({ cancelledBy: SELLER_ID, isAdmin: false })
      .expect(204);

    const res = await bid(auctionId, ctx.tokenFor(BIDDER1_ID), { amountCents: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUCTION_CANCELLED');
  });

  it('returns 404 for a placeholder row cancelled before it was published', async () => {
    const auctionId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO auction_state (auction_id, seller_id, title, status, cancelled_by, cancelled_at)
       VALUES ($1, $2, 'Lamp', 'CANCELLED', $2, now())`,
      [auctionId, SELLER_ID],
    );
    const res = await bid(auctionId, ctx.tokenFor(BIDDER1_ID), { amountCents: 1000 });
    expect(res.status).toBe(404);
  });

  it('stores nothing and publishes nothing for a rejected bid', async () => {
    await bid(LIVE_WITH_BIDS_ID, ctx.tokenFor(BIDDER1_ID), { amountCents: 100 });
    expect(await stateOf(LIVE_WITH_BIDS_ID)).toMatchObject({ bid_count: 2, version: '2' });
    expect(ctx.published).toHaveLength(0);
  });
});

describe('concurrency', () => {
  it('waits for the row lock and then sees the change made by its holder', async () => {
    // Deterministic, unlike a plain race: another transaction holds the lock, the bid has to wait,
    // and the auction is cancelled meanwhile. Without FOR UPDATE the bid would read the old OPEN
    // state, skip the wait, and be accepted on a cancelled auction.
    const auctionId = await ctx.addAuction();
    const holder = await ctx.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM auction_state WHERE auction_id = $1 FOR UPDATE', [
        auctionId,
      ]);

      let finished = false;
      const pending = bid(auctionId, ctx.tokenFor(BIDDER1_ID), { amountCents: 1000 }).then(
        (res) => {
          finished = true;
          return res;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(finished).toBe(false);

      await holder.query(
        `UPDATE auction_state SET status = 'CANCELLED', cancelled_by = seller_id,
           cancelled_at = now() WHERE auction_id = $1`,
        [auctionId],
      );
      await holder.query('COMMIT');

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('AUCTION_CANCELLED');
    } finally {
      holder.release();
    }
  });

  it('accepts exactly one of many equal bids sent at the same moment', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    const bidders = Array.from({ length: 20 }, () => randomUUID());

    const responses = await Promise.all(
      bidders.map((bidder) => bid(auctionId, ctx.tokenFor(bidder), { amountCents: 1000 })),
    );

    const statuses = responses.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(19);
    expect((await stateOf(auctionId)).bid_count).toBe(1);
  });

  it('gives rising bids from parallel bidders one consistent order', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    const amounts = Array.from({ length: 20 }, (_, i) => 1000 + i * 100);

    await Promise.all(
      amounts.map((amountCents) => bid(auctionId, ctx.tokenFor(randomUUID()), { amountCents })),
    );

    const bids = await ctx.pool.query<{ sequence: number; amount_cents: string }>(
      'SELECT sequence, amount_cents FROM bids WHERE auction_id = $1 ORDER BY sequence',
      [auctionId],
    );
    const accepted = bids.rows.map((row) => Number(row.amount_cents));
    // Whatever was accepted, the amounts rise with the sequence and the state matches the last one.
    expect(accepted).toEqual([...accepted].sort((a, b) => a - b));
    expect(bids.rows.map((row) => row.sequence)).toEqual(accepted.map((_, i) => i + 1));
    const state = await stateOf(auctionId);
    expect(state.bid_count).toBe(accepted.length);
    expect(Number(state.highest_bid_cents)).toBe(accepted.at(-1));
  });
});
