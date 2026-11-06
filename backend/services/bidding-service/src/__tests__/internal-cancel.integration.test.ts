// POST /internal/auctions/:id/cancel against a real Postgres (B-06, docs/events.md §8).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  BIDDER1_ID,
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

const cancel = (auctionId: string, body: unknown) =>
  request(ctx.app)
    .post(`/internal/auctions/${auctionId}/cancel`)
    .send(body as object);

async function statusOf(auctionId: string) {
  const result = await ctx.pool.query<{ status: string; cancelled_by: string | null }>(
    'SELECT status, cancelled_by FROM auction_state WHERE auction_id = $1',
    [auctionId],
  );
  return result.rows[0]!;
}

it('cancels an auction without bids (204)', async () => {
  const res = await cancel(LIVE_NO_BIDS_ID, { cancelledBy: SELLER_ID, isAdmin: false });
  expect(res.status).toBe(204);
  expect(await statusOf(LIVE_NO_BIDS_ID)).toEqual({
    status: 'CANCELLED',
    cancelled_by: SELLER_ID,
  });
});

it('answers 204 again for an auction that is already cancelled', async () => {
  await cancel(LIVE_NO_BIDS_ID, { cancelledBy: SELLER_ID, isAdmin: false }).expect(204);
  const res = await cancel(LIVE_NO_BIDS_ID, { cancelledBy: SELLER_ID, isAdmin: false });
  expect(res.status).toBe(204);
});

it('refuses a seller once a bid exists (409 AUCTION_HAS_BIDS)', async () => {
  const res = await cancel(LIVE_WITH_BIDS_ID, { cancelledBy: SELLER_ID, isAdmin: false });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('AUCTION_HAS_BIDS');
  expect((await statusOf(LIVE_WITH_BIDS_ID)).status).toBe('OPEN');
});

it('lets an admin cancel even with bids', async () => {
  const adminId = randomUUID();
  const res = await cancel(LIVE_WITH_BIDS_ID, { cancelledBy: adminId, isAdmin: true });
  expect(res.status).toBe(204);
  expect((await statusOf(LIVE_WITH_BIDS_ID)).cancelled_by).toBe(adminId);
});

it('refuses a closed auction (409 AUCTION_CLOSED)', async () => {
  const res = await cancel(CLOSED_ID, { cancelledBy: SELLER_ID, isAdmin: true });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('AUCTION_CLOSED');
});

it('refuses an auction whose end time has passed (409 AUCTION_CLOSED)', async () => {
  const auctionId = await ctx.addAuction({ startsInSeconds: -120, endsInSeconds: -1 });
  const res = await cancel(auctionId, { cancelledBy: SELLER_ID, isAdmin: false });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('AUCTION_CLOSED');
});

it('returns 404 AUCTION_NOT_FOUND for an auction bidding has not seen', async () => {
  const res = await cancel(randomUUID(), { cancelledBy: SELLER_ID, isAdmin: false });
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('AUCTION_NOT_FOUND');
});

it.each([
  ['a missing isAdmin', { cancelledBy: SELLER_ID }],
  ['cancelledBy not a UUID', { cancelledBy: 'me', isAdmin: false }],
  ['an unknown field', { cancelledBy: SELLER_ID, isAdmin: false, force: true }],
])('rejects %s (400)', async (_name, body) => {
  const res = await cancel(LIVE_NO_BIDS_ID, body);
  expect(res.status).toBe(400);
});

it('never lets a bid and a cancel both succeed when they race', async () => {
  // Repeated, because the outcome depends on which one gets the row lock first.
  for (let round = 0; round < 10; round += 1) {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000 });
    const [bidRes, cancelRes] = await Promise.all([
      request(ctx.app)
        .post(`/api/v1/auctions/${auctionId}/bids`)
        .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
        .send({ amountCents: 1000 }),
      cancel(auctionId, { cancelledBy: SELLER_ID, isAdmin: false }),
    ]);

    const bidWon = bidRes.status === 201;
    const cancelWon = cancelRes.status === 204;
    expect(bidWon !== cancelWon).toBe(true);
    expect((await statusOf(auctionId)).status).toBe(bidWon ? 'OPEN' : 'CANCELLED');
  }
});
