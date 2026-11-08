// B-13: the promise of the whole service, "never accept two conflicting bids", under real parallel
// load: 50 bidders hit the same auction at the same instant, on a real Postgres, through the real
// HTTP stack. Whatever the order they arrive in, the result must be one consistent history and one
// winner.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestContext, type TestContext } from './helpers';

const BIDDERS = 50;

let ctx: TestContext;

beforeEach(async () => {
  // 50 bids at once while other test files run: a generous funds-check timeout, so a busy machine
  // cannot turn a correct bid into a 503 and make these tests about the machine, not the rules.
  ctx = await createTestContext({ fundsTimeoutMs: 10_000 });
});

afterEach(async () => {
  await ctx.close();
});

const bid = (auctionId: string, bidder: string, amountCents: number) =>
  request(ctx.app)
    .post(`/api/v1/auctions/${auctionId}/bids`)
    .set('Authorization', `Bearer ${ctx.tokenFor(bidder)}`)
    .send({ amountCents });

/** Counts the answers by status and error code, so a failed test shows what really came back. */
function tally(responses: { status: number; body: { error?: { code?: string } } }[]) {
  const counts: Record<string, number> = {};
  for (const r of responses) {
    const key = r.body?.error?.code ? `${r.status} ${r.body.error.code}` : String(r.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

interface StoredBid {
  sequence: number;
  amount_cents: string;
  bidder_id: string;
}

async function storedBids(auctionId: string): Promise<StoredBid[]> {
  const result = await ctx.pool.query<StoredBid>(
    'SELECT sequence, amount_cents, bidder_id FROM bids WHERE auction_id = $1 ORDER BY sequence',
    [auctionId],
  );
  return result.rows;
}

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

/** The history is one consistent line: 1, 2, 3 ... with every amount higher than the one before. */
function expectConsistentHistory(bids: StoredBid[], increment: number, first: number) {
  expect(bids.map((b) => b.sequence)).toEqual(bids.map((_, i) => i + 1));
  bids.forEach((b, i) => {
    const amount = Number(b.amount_cents);
    if (i === 0) {
      expect(amount).toBeGreaterThanOrEqual(first);
    } else {
      expect(amount).toBeGreaterThanOrEqual(Number(bids[i - 1]!.amount_cents) + increment);
    }
  });
}

describe(`${BIDDERS} bidders at the same moment`, () => {
  it('accepts exactly one of 50 identical first bids and refuses the rest with 409', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    const bidders = Array.from({ length: BIDDERS }, () => randomUUID());

    const responses = await Promise.all(bidders.map((b) => bid(auctionId, b, 1000)));

    expect(tally(responses)).toEqual({ '201': 1, '409 BID_TOO_LOW': BIDDERS - 1 });
    const accepted = responses.filter((r) => r.status === 201);
    const refused = responses.filter((r) => r.status === 409);
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(BIDDERS - 1);
    expect(
      refused.every((r) => ['BID_TOO_LOW', 'ALREADY_HIGHEST_BIDDER'].includes(r.body.error.code)),
    ).toBe(true);
    expect(await storedBids(auctionId)).toHaveLength(1);
    expect((await stateOf(auctionId)).bid_count).toBe(1);
  });

  it('keeps one consistent history when 50 different amounts arrive in any order', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    // Amounts 1000, 1100 ... 5900, each from a different bidder, all sent at once.
    const amounts = Array.from({ length: BIDDERS }, (_, i) => 1000 + i * 100);

    const responses = await Promise.all(amounts.map((a) => bid(auctionId, randomUUID(), a)));

    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const acceptedBodies = responses.filter((r) => r.status === 201).map((r) => r.body.bid);
    const bids = await storedBids(auctionId);
    expect(bids).toHaveLength(acceptedBodies.length);
    expect(bids.length).toBeGreaterThanOrEqual(1);
    expectConsistentHistory(bids, 100, 1000);

    // Every accepted answer matches exactly one row, and no sequence number was given twice.
    const sequences = acceptedBodies.map((b: { sequence: number }) => b.sequence);
    expect(new Set(sequences).size).toBe(acceptedBodies.length);

    // The state agrees with the history: the last bid in the line is the highest bid.
    const last = bids.at(-1)!;
    const state = await stateOf(auctionId);
    expect(Number(state.highest_bid_cents)).toBe(Number(last.amount_cents));
    expect(state.highest_bidder_id).toBe(last.bidder_id);
    expect(state.bid_count).toBe(bids.length);
    // The overall highest amount was sent by someone, so it can only lose to a refusal if a bid
    // that was already higher arrived first; either way the winner is the highest accepted one.
    expect(Number(last.amount_cents)).toBe(Math.max(...bids.map((b) => Number(b.amount_cents))));
  });

  it('lets a single bidder place only one of 20 simultaneous bids', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    const bidder = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bid(auctionId, bidder, 1000 + i * 100)),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await storedBids(auctionId)).length).toBe(1);
  });

  it('survives a mixed burst of valid and invalid bids without a single server error', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });

    const responses = await Promise.all(
      Array.from({ length: BIDDERS }, (_, i) =>
        // Every third bid is below the starting price and must be refused.
        bid(auctionId, randomUUID(), i % 3 === 0 ? 500 : 1000 + i * 100),
      ),
    );

    // Every refusal is a clean 409 BID_TOO_LOW, every acceptance a 201: never a 5xx.
    expect(
      Object.keys(tally(responses)).every((key) =>
        /^(201|409 BID_TOO_LOW|409 ALREADY_HIGHEST_BIDDER)$/.test(key),
      ),
    ).toBe(true);
    for (const [i, response] of responses.entries()) {
      if (i % 3 === 0) {
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('BID_TOO_LOW');
      }
    }
    expectConsistentHistory(await storedBids(auctionId), 100, 1000);
  });
});

describe('one winner when the auction closes', () => {
  it('names the highest accepted bidder as the only winner and tells every other bidder they lost', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    const amounts = Array.from({ length: BIDDERS }, (_, i) => 1000 + i * 100);
    await Promise.all(amounts.map((a) => bid(auctionId, randomUUID(), a)));
    const bids = await storedBids(auctionId);
    const winning = bids.at(-1)!;

    await ctx.expireAuction(auctionId);
    // Two workers on two replicas look at the same moment: still exactly one closing.
    const [a, b] = await Promise.all([
      ctx.newClosingService().closeExpiredAuctions(),
      ctx.newClosingService().closeExpiredAuctions(),
    ]);
    expect(a + b).toBe(1);
    expect(await ctx.newClosingService().closeExpiredAuctions()).toBe(0);

    const closed = ctx.published.filter((event) => event.type === 'auction.closed');
    expect(closed).toHaveLength(1);
    const payload = closed[0]!.payload as {
      result: string;
      winnerId: string;
      amountCents: number;
      losingBidderIds: string[];
    };
    expect(payload.result).toBe('SOLD');
    expect(payload.winnerId).toBe(winning.bidder_id);
    expect(payload.amountCents).toBe(Number(winning.amount_cents));
    // Everybody who bid and is not the winner, once each.
    const others = [...new Set(bids.map((x) => x.bidder_id))].filter(
      (id) => id !== winning.bidder_id,
    );
    expect([...payload.losingBidderIds].sort()).toEqual(others.sort());
  });

  it('refuses every bid that arrives after the auction ended, however many at once', async () => {
    const auctionId = await ctx.addAuction({ startingPriceCents: 1000, minIncrementCents: 100 });
    await ctx.expireAuction(auctionId);

    const responses = await Promise.all(
      Array.from({ length: BIDDERS }, () => bid(auctionId, randomUUID(), 5000)),
    );

    expect(tally(responses)).toEqual({ '409 AUCTION_CLOSED': BIDDERS });
    expect(await storedBids(auctionId)).toHaveLength(0);
  });
});
