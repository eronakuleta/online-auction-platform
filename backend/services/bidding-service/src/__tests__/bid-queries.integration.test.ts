// B-08: GET /auctions/:id/state, GET /auctions/:id/bids and GET /bids/me on a real Postgres.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  BIDDER1_ID,
  BIDDER2_ID,
  CLOSED_ID,
  LIVE_NO_BIDS_ID,
  LIVE_WITH_BIDS_ID,
  SELLER_ID,
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

const get = (path: string, token?: string) => {
  const req = request(ctx.app).get(`/api/v1${path}`);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
};

const placeBid = (auctionId: string, bidder: string, amountCents: number) =>
  request(ctx.app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Authorization', `Bearer ${ctx.tokenFor(bidder)}`)
    .send({ amountCents })
    .expect(201);

describe('GET /auctions/:id/state', () => {
  it('shows the live state without a token', async () => {
    const res = await get(`/auctions/${LIVE_WITH_BIDS_ID}/state`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      auctionId: LIVE_WITH_BIDS_ID,
      title: 'Vintage 35mm film camera',
      sellerId: SELLER_ID,
      status: 'OPEN',
      currency: 'EUR',
      highestBidCents: 5500,
      highestBidderId: BIDDER2_ID,
      bidCount: 2,
      minimumNextBidCents: 6000,
      extensionCount: 0,
      version: 2,
    });
    expect(new Date(res.body.endsAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body).not.toHaveProperty('reservePriceCents');
  });

  it('shows the starting price as the minimum when there is no bid', async () => {
    const res = await get(`/auctions/${LIVE_NO_BIDS_ID}/state`);
    expect(res.body).toMatchObject({
      highestBidCents: null,
      bidCount: 0,
      minimumNextBidCents: 2000,
    });
  });

  it('shows a closed auction with its result', async () => {
    const res = await get(`/auctions/${CLOSED_ID}/state`);
    expect(res.body).toMatchObject({ status: 'CLOSED_NO_SALE', highestBidCents: 12000 });
  });

  it('returns 404 for an unknown auction and for a cancelled placeholder', async () => {
    expect((await get(`/auctions/${randomUUID()}/state`)).status).toBe(404);
    const placeholder = randomUUID();
    await ctx.pool.query(
      `INSERT INTO auction_state (auction_id, seller_id, title, status, cancelled_by, cancelled_at)
       VALUES ($1, $2, 'Lamp', 'CANCELLED', $2, now())`,
      [placeholder, SELLER_ID],
    );
    const res = await get(`/auctions/${placeholder}/state`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AUCTION_NOT_FOUND');
  });

  it('returns 400 for an id that is not a UUID', async () => {
    expect((await get('/auctions/abc/state')).status).toBe(400);
  });
});

describe('GET /auctions/:id/bids', () => {
  it('lists the bids newest first, without a token', async () => {
    const res = await get(`/auctions/${LIVE_WITH_BIDS_ID}/bids`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, size: 20, total: 2 });
    expect(res.body.data.map((bid: { amountCents: number }) => bid.amountCents)).toEqual([
      5500, 5000,
    ]);
    expect(res.body.data[0]).toMatchObject({
      auctionId: LIVE_WITH_BIDS_ID,
      bidderId: BIDDER2_ID,
      sequence: 2,
    });
  });

  it('pages through the history', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    for (let i = 0; i < 5; i += 1) {
      await placeBid(auctionId, i % 2 === 0 ? BIDDER1_ID : BIDDER2_ID, 1000 + i * 100);
    }
    const page2 = await get(`/auctions/${auctionId}/bids?page=2&size=2`);
    expect(page2.body).toMatchObject({ page: 2, size: 2, total: 5 });
    expect(page2.body.data.map((bid: { sequence: number }) => bid.sequence)).toEqual([3, 2]);
    const past = await get(`/auctions/${auctionId}/bids?page=9&size=2`);
    expect(past.body).toMatchObject({ data: [], total: 5 });
  });

  it('returns an empty first page for an auction without bids', async () => {
    const res = await get(`/auctions/${LIVE_NO_BIDS_ID}/bids`);
    expect(res.body).toEqual({ data: [], page: 1, size: 20, total: 0 });
  });

  it.each([
    ['page=0', 'page 0'],
    ['size=101', 'size above 100'],
    ['size=0', 'size 0'],
    ['page=x', 'a text page'],
    ['sort=amount', 'an unknown parameter'],
  ])('rejects %s (%s) with 400', async (query) => {
    const res = await get(`/auctions/${LIVE_WITH_BIDS_ID}/bids?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown auction', async () => {
    expect((await get(`/auctions/${randomUUID()}/bids`)).status).toBe(404);
  });
});

describe('GET /bids/me', () => {
  it('lists my bids across auctions, newest first, with whether each is the highest', async () => {
    await placeBid(LIVE_NO_BIDS_ID, BIDDER1_ID, 2000);
    await placeBid(LIVE_NO_BIDS_ID, BIDDER2_ID, 2200);
    await placeBid(LIVE_WITH_BIDS_ID, BIDDER1_ID, 6000);

    const res = await get('/bids/me', ctx.tokenFor(BIDDER1_ID));

    expect(res.status).toBe(200);
    // bidder1 also has two seeded bids (5000 on the camera, 12000 on the closed clock).
    expect(res.body.total).toBe(4);
    expect(res.body.data[0]).toMatchObject({
      auctionId: LIVE_WITH_BIDS_ID,
      amountCents: 6000,
      title: 'Vintage 35mm film camera',
      currency: 'EUR',
      auctionStatus: 'OPEN',
      isHighest: true,
    });
    expect(res.body.data[1]).toMatchObject({
      auctionId: LIVE_NO_BIDS_ID,
      amountCents: 2000,
      isHighest: false,
    });
    // Only bidder1's own bids.
    expect(res.body.data.every((bid: { bidderId: string }) => bid.bidderId === BIDDER1_ID)).toBe(
      true,
    );
  });

  it('marks the winning bid of a closed auction as the highest', async () => {
    const res = await get('/bids/me', ctx.tokenFor(BIDDER1_ID));
    const clock = res.body.data.find((bid: { auctionId: string }) => bid.auctionId === CLOSED_ID);
    expect(clock).toMatchObject({
      auctionStatus: 'CLOSED_NO_SALE',
      isHighest: true,
      amountCents: 12000,
    });
  });

  it('gives an empty list to a user who never bid', async () => {
    const res = await get('/bids/me', ctx.tokenFor(randomUUID(), ['SELLER']));
    expect(res.body).toEqual({ data: [], page: 1, size: 20, total: 0 });
  });

  it('returns 401 without a token', async () => {
    expect((await get('/bids/me')).status).toBe(401);
  });

  it('returns 400 for a size above 100', async () => {
    expect((await get('/bids/me?size=500', ctx.tokenFor(BIDDER1_ID))).status).toBe(400);
  });
});
