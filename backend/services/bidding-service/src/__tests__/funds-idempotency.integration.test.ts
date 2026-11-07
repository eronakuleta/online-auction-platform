// B-10: the funds check against payment-service and the Idempotency-Key, on a real Postgres with a
// real HTTP fake of payment-service.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  BIDDER1_ID,
  BIDDER2_ID,
  LIVE_NO_BIDS_ID,
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

const bid = (
  amountCents: number,
  options: { key?: string; bidder?: string; auctionId?: string } = {},
) => {
  const req = request(ctx.app)
    .post(`/api/v1/auctions/${options.auctionId ?? LIVE_NO_BIDS_ID}/bids`)
    .set('Authorization', `Bearer ${ctx.tokenFor(options.bidder ?? BIDDER1_ID)}`);
  return (options.key === undefined ? req : req.set('Idempotency-Key', options.key)).send({
    amountCents,
  });
};

async function bidCount(auctionId = LIVE_NO_BIDS_ID): Promise<number> {
  const result = await ctx.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM bids WHERE auction_id = $1',
    [auctionId],
  );
  return result.rows[0]!.n;
}

describe('funds check', () => {
  it('asks payment-service for the bidder and the amount', async () => {
    await bid(2000).expect(201);
    expect(ctx.fundsChecks).toEqual([{ userId: BIDDER1_ID, amountCents: 2000 }]);
  });

  it('refuses the bid with 409 INSUFFICIENT_FUNDS when the balance is too low', async () => {
    ctx.answerFundsCheck('insufficient');
    const res = await bid(2000);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await bidCount()).toBe(0);
    expect(ctx.published).toHaveLength(0);
  });

  it('refuses the bid with 409 INSUFFICIENT_FUNDS when the bidder has no wallet', async () => {
    ctx.answerFundsCheck('no-wallet');
    const res = await bid(2000);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'You have no wallet yet. Deposit money before bidding',
    });
  });

  it('tries once more after a 500 and then succeeds', async () => {
    ctx.answerFundsCheck('error', 'sufficient');
    await bid(2000).expect(201);
    expect(ctx.fundsChecks).toHaveLength(2);
  });

  it('answers 503 when payment-service fails twice, and stores no bid', async () => {
    ctx.answerFundsCheck('error', 'error');
    const res = await bid(2000);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(await bidCount()).toBe(0);
  });

  it('answers 503 after the timeout without a second try, so the bidder does not wait twice', async () => {
    ctx.answerFundsCheck('hang');
    const res = await bid(2000);
    expect(res.status).toBe(503);
    expect(ctx.fundsChecks).toHaveLength(1);
  });

  it('checks funds before the rules, so the auction row is never locked during the call', async () => {
    ctx.answerFundsCheck('hang');
    // supertest sends a request only when it is awaited or .then() is called.
    const pending = bid(2000).then((res) => res);
    while (ctx.fundsChecks.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // While payment-service is silent, another bidder can still lock the row and bid.
    await bid(2000, { bidder: BIDDER2_ID }).expect(201);
    expect((await pending).status).toBe(503);
  });
});

describe('Idempotency-Key', () => {
  it('returns the original 201 for a retry and places only one bid', async () => {
    const key = randomUUID();
    const first = await bid(2000, { key });
    const retry = await bid(2000, { key });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await bidCount()).toBe(1);
    expect(ctx.published.filter((event) => event.type === 'bid.placed')).toHaveLength(1);
    // A replay does not even ask payment-service.
    expect(ctx.fundsChecks).toHaveLength(1);
  });

  it('refuses the same key with a different amount (409 IDEMPOTENCY_KEY_REUSED)', async () => {
    const key = randomUUID();
    await bid(2000, { key }).expect(201);
    const res = await bid(2400, { key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await bidCount()).toBe(1);
  });

  it('refuses the same key for a different auction', async () => {
    const key = randomUUID();
    const other = await ctx.addAuction();
    await bid(2000, { key }).expect(201);
    const res = await bid(2000, { key, auctionId: other });
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('replays a rule rejection too, with a new requestId', async () => {
    const key = randomUUID();
    const first = await bid(1999, { key });
    const retry = await bid(1999, { key });
    expect(first.status).toBe(409);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('BID_TOO_LOW');
    expect(retry.body.error.message).toBe(first.body.error.message);
    expect(retry.body.error.requestId).not.toBe(first.body.error.requestId);
  });

  it('frees the key after a 503, so the retry is really tried again', async () => {
    const key = randomUUID();
    ctx.answerFundsCheck('error', 'error');
    await bid(2000, { key }).expect(503);
    await bid(2000, { key }).expect(201);
    expect(await bidCount()).toBe(1);
  });

  it('keeps keys separate per user', async () => {
    const key = 'shared-key';
    await bid(2000, { key }).expect(201);
    await bid(2200, { key, bidder: BIDDER2_ID }).expect(201);
    expect(await bidCount()).toBe(2);
  });

  it('places one bid when the same request is sent twice at the same moment', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([bid(2000, { key }), bid(2000, { key })]);
    const statuses = [a.status, b.status].sort();
    // The second one either waited and replayed (201) or found the first still running (409).
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    expect(await bidCount()).toBe(1);
  });

  it.each([
    ['too long', 'k'.repeat(256)],
    ['a space', 'has space'],
    ['a dot', 'a.b'],
  ])('rejects a key with %s (400)', async (_name, key) => {
    const res = await bid(2000, { key });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await bidCount()).toBe(0);
  });

  it('works without the header, as before', async () => {
    await bid(2000).expect(201);
    await bid(2200, { bidder: BIDDER2_ID }).expect(201);
    expect(await bidCount()).toBe(2);
  });
});
