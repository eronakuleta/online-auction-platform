import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CATEGORY_ID,
  DEMO_SELLER_ID,
  OTHER_CATEGORY_ID,
  SEEDED_CLOSED_ID,
  SEEDED_DRAFT_ID,
  SEEDED_LIVE_ID,
  createTestContext,
  newAuction,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let sellerId: string;
let sellerToken: string;
let otherSellerToken: string;
let bidderToken: string;
let adminToken: string;

const AUCTIONS = '/api/v1/auctions';

beforeAll(async () => {
  ctx = await createTestContext();
  sellerId = randomUUID();
  sellerToken = ctx.tokenFor(['BIDDER', 'SELLER'], sellerId);
  otherSellerToken = ctx.tokenFor(['SELLER']);
  bidderToken = ctx.tokenFor(['BIDDER']);
  adminToken = ctx.tokenFor(['ADMIN']);
});

afterAll(async () => {
  await ctx.close();
});

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function post(path: string, token: string, body?: object) {
  return request(ctx.app).post(path).set(bearer(token)).send(body);
}

async function createDraft(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await post(AUCTIONS, sellerToken, newAuction(overrides)).expect(201);
  return response.body.id as string;
}

async function createPublished(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await createDraft(overrides);
  await post(`${AUCTIONS}/${id}/publish`, sellerToken).expect(200);
  return id;
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await ctx.pool.query<{ status: string }>(
    'SELECT status FROM auctions WHERE id = $1',
    [id],
  );
  return rows[0]?.status;
}

/** A row in each of the states after PUBLISHED, as the events in A-13 will produce them. */
async function closedAs(status: string): Promise<string> {
  const id = await createPublished();
  const winnerId = status === 'CLOSED_NO_SALE' ? null : randomUUID();
  await ctx.pool.query(
    `UPDATE auctions SET status = $2, closed_at = now(), winner_id = $3, final_price_cents = $4
     WHERE id = $1`,
    [id, status, winnerId, winnerId ? 5000 : null],
  );
  return id;
}

describe('POST /auctions', () => {
  it('creates a draft owned by the caller', async () => {
    const body = newAuction();
    const response = await post(AUCTIONS, sellerToken, body);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`${AUCTIONS}/${response.body.id}`);
    expect(response.body).toMatchObject({
      sellerId,
      status: 'DRAFT',
      phase: null,
      title: 'Test auction',
      currency: 'EUR',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      reservePriceCents: 2000,
      imageUrls: body.imageUrls,
      publishedAt: null,
      winnerId: null,
    });
    expect(response.body.startsAt).toBe(body.startsAt);
  });

  it('applies the defaults for the optional fields', async () => {
    // JSON leaves out undefined fields, so these are simply not sent.
    const minimal = newAuction({
      description: undefined,
      reservePriceCents: undefined,
      imageUrls: undefined,
    });
    const response = await post(AUCTIONS, sellerToken, minimal);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      description: '',
      reservePriceCents: null,
      imageUrls: [],
    });
  });

  it('normalises times with an offset to UTC', async () => {
    const response = await post(
      AUCTIONS,
      sellerToken,
      newAuction({ startsAt: '2030-01-01T12:00:00+01:00', endsAt: '2030-01-02T12:00:00+01:00' }),
    );

    expect(response.body.startsAt).toBe('2030-01-01T11:00:00.000Z');
  });

  it.each([
    ['no title', { title: undefined }],
    ['a title that is too short', { title: '  ab  ' }],
    ['a title that is too long', { title: 'x'.repeat(121) }],
    ['a NUL character in the title', { title: 'bad\u0000title' }],
    ['a description that is too long', { description: 'x'.repeat(5001) }],
    ['a decimal price', { startingPriceCents: 10.5 }],
    ['a price as text', { startingPriceCents: '1000' }],
    ['a zero price', { startingPriceCents: 0 }],
    ['a negative increment', { minIncrementCents: -1 }],
    ['a zero reserve', { reservePriceCents: 0 }],
    ['an unsafe integer', { startingPriceCents: 2 ** 53 }],
    ['a date that is not a timestamp', { startsAt: 'tomorrow' }],
    ['an impossible date', { startsAt: '2030-02-31T00:00:00Z' }],
    ['a category that is not a UUID', { categoryId: 'art' }],
    ['a javascript: image URL', { imageUrls: ['javascript:alert(1)'] }],
    ['too many images', { imageUrls: Array(11).fill('https://images.test/a.png') }],
    ['a status field', { status: 'PUBLISHED' }],
    ['a sellerId field', { sellerId: randomUUID() }],
    ['a currency field', { currency: 'USD' }],
  ])('answers 400 for %s', async (_case, overrides) => {
    const response = await post(AUCTIONS, sellerToken, newAuction(overrides));
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 400 when the end is not after the start', async () => {
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const response = await post(AUCTIONS, sellerToken, newAuction({ startsAt, endsAt: startsAt }));

    expectError(response, 400, 'VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('endsAt');
  });

  it('answers 400 for a category that does not exist, and saves nothing', async () => {
    const title = `Orphan ${randomUUID()}`;
    const response = await post(
      AUCTIONS,
      sellerToken,
      newAuction({ categoryId: randomUUID(), title }),
    );

    expectError(response, 400, 'VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('categoryId');
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM auctions WHERE title = $1', [title]);
    expect(rowCount).toBe(0);
  });

  it('treats SQL in a field as plain text', async () => {
    const title = "x'); DROP TABLE auctions;--";
    const response = await post(AUCTIONS, sellerToken, newAuction({ title }));

    expect(response.status).toBe(201);
    expect(response.body.title).toBe(title);
    await ctx.pool.query('SELECT 1 FROM auctions LIMIT 1');
  });

  it('answers 401 without a token and 403 for a bidder or admin', async () => {
    expectError(await request(ctx.app).post(AUCTIONS).send(newAuction()), 401, 'UNAUTHORIZED');
    expectError(await post(AUCTIONS, bidderToken, newAuction()), 403, 'FORBIDDEN');
    expectError(await post(AUCTIONS, adminToken, newAuction()), 403, 'FORBIDDEN');
  });
});

describe('GET /auctions/:id', () => {
  it('shows a published auction to a visitor, without the reserve price', async () => {
    const response = await request(ctx.app).get(`${AUCTIONS}/${SEEDED_LIVE_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: SEEDED_LIVE_ID,
      sellerId: DEMO_SELLER_ID,
      status: 'PUBLISHED',
      phase: 'LIVE',
      startingPriceCents: 5000,
    });
    expect(response.body).not.toHaveProperty('reservePriceCents');
    expect(response.body.imageUrls).toHaveLength(2);
    expect(response.body).not.toHaveProperty('search_vector');
  });

  it('shows the reserve price only to the seller and admins', async () => {
    const id = await createPublished();
    const url = `${AUCTIONS}/${id}`;

    const seller = await request(ctx.app).get(url).set(bearer(sellerToken));
    const admin = await request(ctx.app).get(url).set(bearer(adminToken));
    const other = await request(ctx.app).get(url).set(bearer(otherSellerToken));

    expect(seller.body.reservePriceCents).toBe(2000);
    expect(admin.body.reservePriceCents).toBe(2000);
    expect(other.body).not.toHaveProperty('reservePriceCents');
  });

  it('derives the phase from the times', async () => {
    const upcoming = await createPublished();
    const ended = await createPublished();
    await ctx.pool.query(
      `UPDATE auctions SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
       WHERE id = $1`,
      [ended],
    );

    const first = await request(ctx.app).get(`${AUCTIONS}/${upcoming}`);
    const second = await request(ctx.app).get(`${AUCTIONS}/${ended}`);

    expect(first.body.phase).toBe('UPCOMING');
    expect(second.body.phase).toBe('ENDED');
    expect(second.body.status).toBe('PUBLISHED');
  });

  it('hides a draft: 404 for visitors, bidders and other sellers (Q4)', async () => {
    const id = await createDraft();
    const url = `${AUCTIONS}/${id}`;

    expectError(await request(ctx.app).get(url), 404, 'NOT_FOUND');
    expectError(await request(ctx.app).get(url).set(bearer(bidderToken)), 404, 'NOT_FOUND');
    expectError(await request(ctx.app).get(url).set(bearer(otherSellerToken)), 404, 'NOT_FOUND');
  });

  it('shows a draft to its seller and admins (Q4)', async () => {
    const id = await createDraft();
    const url = `${AUCTIONS}/${id}`;

    await request(ctx.app).get(url).set(bearer(sellerToken)).expect(200);
    await request(ctx.app).get(url).set(bearer(adminToken)).expect(200);
  });

  it('keeps a draft hidden after it is cancelled', async () => {
    const id = await createDraft();
    await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(200);

    expectError(await request(ctx.app).get(`${AUCTIONS}/${id}`), 404, 'NOT_FOUND');
  });

  it('answers 401 for a bad token, instead of treating the caller as a visitor', async () => {
    const response = await request(ctx.app)
      .get(`${AUCTIONS}/${SEEDED_LIVE_ID}`)
      .set('Authorization', 'Bearer a.b.c');

    expectError(response, 401, 'UNAUTHORIZED');
  });

  it('answers 400 for a bad ID and 404 for an unknown one', async () => {
    expectError(await request(ctx.app).get(`${AUCTIONS}/abc`), 400, 'VALIDATION_ERROR');
    expectError(await request(ctx.app).get(`${AUCTIONS}/${randomUUID()}`), 404, 'NOT_FOUND');
  });
});

describe('PATCH /auctions/:id', () => {
  function patch(id: string, token: string, body: object) {
    return request(ctx.app).patch(`${AUCTIONS}/${id}`).set(bearer(token)).send(body);
  }

  it('changes only the fields that were sent', async () => {
    const id = await createDraft();

    const response = await patch(id, sellerToken, { title: 'New title' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      title: 'New title',
      description: 'A thing for sale',
      startingPriceCents: 1000,
      reservePriceCents: 2000,
    });
    expect(response.body.imageUrls).toHaveLength(2);
  });

  it('removes the reserve price with null', async () => {
    const id = await createDraft();

    const response = await patch(id, sellerToken, { reservePriceCents: null });

    expect(response.body.reservePriceCents).toBeNull();
  });

  it('replaces the images, keeping the new order', async () => {
    const id = await createDraft();
    const imageUrls = ['https://images.test/b.png', 'https://images.test/a.png'];

    expect((await patch(id, sellerToken, { imageUrls })).body.imageUrls).toEqual(imageUrls);
    expect((await patch(id, sellerToken, { imageUrls: [] })).body.imageUrls).toEqual([]);
  });

  it('changes the category to another that exists', async () => {
    const id = await createDraft();

    const response = await patch(id, sellerToken, { categoryId: OTHER_CATEGORY_ID });

    expect(response.body.categoryId).toBe(OTHER_CATEGORY_ID);
  });

  it('checks the end time against the stored start time', async () => {
    const id = await createDraft({
      startsAt: '2030-01-10T00:00:00Z',
      endsAt: '2030-01-20T00:00:00Z',
    });

    const response = await patch(id, sellerToken, { endsAt: '2030-01-05T00:00:00Z' });

    expectError(response, 400, 'VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('endsAt');
  });

  it.each([
    ['an empty body', {}],
    ['a status field', { status: 'PUBLISHED' }],
    ['a sellerId field', { sellerId: randomUUID() }],
    ['a decimal price', { startingPriceCents: 1.5 }],
    ['a blank title', { title: '   ' }],
    ['a null title', { title: null }],
  ])('answers 400 for %s', async (_case, body) => {
    expectError(await patch(await createDraft(), sellerToken, body), 400, 'VALIDATION_ERROR');
  });

  it('answers 400 for a category that does not exist', async () => {
    const response = await patch(await createDraft(), sellerToken, { categoryId: randomUUID() });
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it.each(['PUBLISHED', 'CANCELLED'])('answers 409 once the auction is %s', async (state) => {
    const id = state === 'PUBLISHED' ? await createPublished() : await createDraft();
    if (state === 'CANCELLED') {
      await post(`${AUCTIONS}/${id}/cancel`, sellerToken).expect(200);
    }

    expectError(await patch(id, sellerToken, { title: 'Too late' }), 409, 'AUCTION_NOT_DRAFT');
  });

  it('answers 404 for another seller on a draft, and 403 on a published auction', async () => {
    const draft = await createDraft();
    const published = await createPublished();

    expectError(await patch(draft, otherSellerToken, { title: 'Mine' }), 404, 'NOT_FOUND');
    expectError(await patch(published, otherSellerToken, { title: 'Mine' }), 403, 'FORBIDDEN');
  });

  it('answers 401 without a token, 403 for a bidder or admin, 404 for an unknown ID', async () => {
    const id = await createDraft();

    expectError(
      await request(ctx.app).patch(`${AUCTIONS}/${id}`).send({ title: 'x12' }),
      401,
      'UNAUTHORIZED',
    );
    expectError(await patch(id, bidderToken, { title: 'x12' }), 403, 'FORBIDDEN');
    expectError(await patch(id, adminToken, { title: 'x12' }), 403, 'FORBIDDEN');
    expectError(await patch(randomUUID(), sellerToken, { title: 'x12' }), 404, 'NOT_FOUND');
  });
});

describe('POST /auctions/:id/publish', () => {
  it('moves a draft to PUBLISHED and makes it public', async () => {
    const id = await createDraft();

    const response = await post(`${AUCTIONS}/${id}/publish`, sellerToken);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PUBLISHED');
    expect(response.body.phase).toBe('UPCOMING');
    expect(response.body.publishedAt).not.toBeNull();
    await request(ctx.app).get(`${AUCTIONS}/${id}`).expect(200);
  });

  it('allows a start time in the past, so the auction is live at once', async () => {
    const id = await createDraft({
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const response = await post(`${AUCTIONS}/${id}/publish`, sellerToken);

    expect(response.body.phase).toBe('LIVE');
  });

  it('answers 409 if the end time has passed', async () => {
    const id = await createDraft({
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-01-02T00:00:00Z',
    });

    expectError(await post(`${AUCTIONS}/${id}/publish`, sellerToken), 409, 'AUCTION_ALREADY_ENDED');
    expect(await statusOf(id)).toBe('DRAFT');
  });

  it('answers 409 the second time', async () => {
    const id = await createPublished();

    expectError(await post(`${AUCTIONS}/${id}/publish`, sellerToken), 409, 'AUCTION_NOT_DRAFT');
  });

  it('lets only one of many parallel publishes succeed', async () => {
    const id = await createDraft();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post(`${AUCTIONS}/${id}/publish`, sellerToken)),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
  });

  it('answers 404 for another seller on a draft, even an admin gets 403', async () => {
    const id = await createDraft();

    expectError(await post(`${AUCTIONS}/${id}/publish`, otherSellerToken), 404, 'NOT_FOUND');
    expectError(await post(`${AUCTIONS}/${id}/publish`, adminToken), 403, 'FORBIDDEN');
    expect(await statusOf(id)).toBe('DRAFT');
  });

  it('answers 401, 403 for a bidder, 400 for a bad ID and 404 for an unknown one', async () => {
    const id = await createDraft();

    expectError(await request(ctx.app).post(`${AUCTIONS}/${id}/publish`), 401, 'UNAUTHORIZED');
    expectError(await post(`${AUCTIONS}/${id}/publish`, bidderToken), 403, 'FORBIDDEN');
    expectError(await post(`${AUCTIONS}/abc/publish`, sellerToken), 400, 'VALIDATION_ERROR');
    expectError(await post(`${AUCTIONS}/${randomUUID()}/publish`, sellerToken), 404, 'NOT_FOUND');
  });
});

describe('POST /auctions/:id/cancel', () => {
  function cancel(id: string, token: string = sellerToken) {
    return post(`${AUCTIONS}/${id}/cancel`, token);
  }

  it('cancels a draft without calling bidding-service', async () => {
    const id = await createDraft();
    const calls = ctx.biddingCalls.length;

    const response = await cancel(id);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
    expect(ctx.biddingCalls).toHaveLength(calls);
  });

  it('asks bidding-service first for a published auction (docs/events.md §8)', async () => {
    const id = await createPublished();

    const response = await cancel(id).set('X-Request-Id', 'trace-1');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
    expect(ctx.biddingCalls.at(-1)).toEqual({
      auctionId: id,
      body: { cancelledBy: sellerId, isAdmin: false },
      requestId: 'trace-1',
    });
  });

  it('tells bidding-service when the caller is an admin', async () => {
    const id = await createPublished();

    await cancel(id, adminToken).expect(200);

    expect(ctx.biddingCalls.at(-1)?.body.isAdmin).toBe(true);
  });

  it('cancels when bidding-service has not seen the auction yet (404)', async () => {
    const id = await createPublished();
    ctx.answerNextCancel({
      status: 404,
      body: { error: { code: 'AUCTION_NOT_FOUND', message: 'x', details: [], requestId: 'r' } },
    });

    const response = await cancel(id);

    expect(response.body.status).toBe('CANCELLED');
  });

  it.each(['AUCTION_HAS_BIDS', 'AUCTION_CLOSED'])(
    'passes on the refusal %s and changes nothing',
    async (code) => {
      const id = await createPublished();
      ctx.answerNextCancel({
        status: 409,
        body: { error: { code, message: 'x', details: [], requestId: 'r' } },
      });

      expectError(await cancel(id), 409, code);
      expect(await statusOf(id)).toBe('PUBLISHED');
    },
  );

  it.each([
    ['a 500', { status: 500 }],
    ['a 409 with an unknown code', { status: 409, body: { error: { code: 'WHAT' } } }],
    ['a 409 without a JSON body', { status: 409 }],
    ['a timeout', { status: 204, hang: true }],
  ])('answers 503 and changes nothing after %s', async (_case, answer) => {
    const id = await createPublished();
    ctx.answerNextCancel(answer);

    expectError(await cancel(id), 503, 'SERVICE_UNAVAILABLE');
    expect(await statusOf(id)).toBe('PUBLISHED');
  });

  it('answers 409 if the auction closes during the call to bidding-service', async () => {
    const id = await createPublished();
    ctx.answerNextCancel({
      status: 204,
      before: async () => {
        await ctx.pool.query(
          `UPDATE auctions SET status = 'CLOSED_NO_SALE', closed_at = now() WHERE id = $1`,
          [id],
        );
      },
    });

    expectError(await cancel(id), 409, 'AUCTION_STATE_CHANGED');
    expect(await statusOf(id)).toBe('CLOSED_NO_SALE');
  });

  it('does not hold the row lock during the call to bidding-service', async () => {
    const id = await createPublished();
    let lockFree = false;
    ctx.answerNextCancel({
      status: 204,
      before: async () => {
        const { rowCount } = await ctx.pool.query(
          'SELECT 1 FROM auctions WHERE id = $1 FOR UPDATE NOWAIT',
          [id],
        );
        lockFree = rowCount === 1;
      },
    });

    await cancel(id).expect(200);

    expect(lockFree).toBe(true);
  });

  it('lets only one of two parallel cancels succeed', async () => {
    const id = await createPublished();

    const responses = await Promise.all([cancel(id), cancel(id)]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('answers 409 for an auction that is already cancelled', async () => {
    const id = await createPublished();
    await cancel(id).expect(200);

    expectError(await cancel(id), 409, 'AUCTION_NOT_CANCELLABLE');
  });

  it.each(['CLOSED_NO_SALE', 'CLOSED_SOLD', 'SETTLED', 'PAYMENT_FAILED'])(
    'answers 409 for a %s auction, also for an admin',
    async (state) => {
      const id = await closedAs(state);
      const calls = ctx.biddingCalls.length;

      expectError(await cancel(id), 409, 'AUCTION_NOT_CANCELLABLE');
      expectError(await cancel(id, adminToken), 409, 'AUCTION_NOT_CANCELLABLE');
      expect(ctx.biddingCalls).toHaveLength(calls);
    },
  );

  it('lets an admin cancel a draft of any seller, and refuses other sellers', async () => {
    const draft = await createDraft();
    const published = await createPublished();

    expectError(await cancel(draft, otherSellerToken), 404, 'NOT_FOUND');
    expectError(await cancel(published, otherSellerToken), 403, 'FORBIDDEN');
    expect(await statusOf(published)).toBe('PUBLISHED');

    await cancel(draft, adminToken).expect(200);
  });

  it('answers 401, 403 for a bidder, 400 for a bad ID and 404 for an unknown one', async () => {
    const id = await createPublished();

    expectError(await request(ctx.app).post(`${AUCTIONS}/${id}/cancel`), 401, 'UNAUTHORIZED');
    expectError(await cancel(id, bidderToken), 403, 'FORBIDDEN');
    expectError(await cancel('abc'), 400, 'VALIDATION_ERROR');
    expectError(await cancel(randomUUID()), 404, 'NOT_FOUND');
  });
});

describe('DELETE /auctions/:id', () => {
  function remove(id: string, token: string = sellerToken) {
    return request(ctx.app).delete(`${AUCTIONS}/${id}`).set(bearer(token));
  }

  it('deletes a draft and its images', async () => {
    const id = await createDraft();

    await remove(id).expect(204);

    expect(await statusOf(id)).toBeUndefined();
    const { rowCount } = await ctx.pool.query(
      'SELECT 1 FROM auction_images WHERE auction_id = $1',
      [id],
    );
    expect(rowCount).toBe(0);
  });

  it('answers 409 for anything but a draft', async () => {
    const published = await createPublished();

    expectError(await remove(published), 409, 'AUCTION_NOT_DRAFT');
    expect(await statusOf(published)).toBe('PUBLISHED');
  });

  it('answers 404 the second time', async () => {
    const id = await createDraft();
    await remove(id).expect(204);

    expectError(await remove(id), 404, 'NOT_FOUND');
  });

  it('answers 404 for another seller on a draft, 403 for an admin or on a published one', async () => {
    const draft = await createDraft();
    const published = await createPublished();

    expectError(await remove(draft, otherSellerToken), 404, 'NOT_FOUND');
    expectError(await remove(published, otherSellerToken), 403, 'FORBIDDEN');
    expectError(await remove(draft, adminToken), 403, 'FORBIDDEN');
    expect(await statusOf(draft)).toBe('DRAFT');
  });

  it('answers 401, 403 for a bidder, 400 for a bad ID', async () => {
    const id = await createDraft();

    expectError(await request(ctx.app).delete(`${AUCTIONS}/${id}`), 401, 'UNAUTHORIZED');
    expectError(await remove(id, bidderToken), 403, 'FORBIDDEN');
    expectError(await remove('abc'), 400, 'VALIDATION_ERROR');
  });
});

describe('seed data and other routes', () => {
  it('lets the demo seller manage the seeded draft', async () => {
    const demoSeller = ctx.tokenFor(['BIDDER', 'SELLER'], DEMO_SELLER_ID);

    const response = await request(ctx.app)
      .patch(`${AUCTIONS}/${SEEDED_DRAFT_ID}`)
      .set(bearer(demoSeller))
      .send({ categoryId: CATEGORY_ID });

    expect(response.status).toBe(200);
  });

  it('returns the seeded closed auction as it is', async () => {
    const response = await request(ctx.app).get(`${AUCTIONS}/${SEEDED_CLOSED_ID}`);

    expect(response.body).toMatchObject({ status: 'CLOSED_NO_SALE', phase: null });
    expect(response.body.closedAt).not.toBeNull();
  });

  it('GET /health answers 200, and an unknown route gets the standard 404', async () => {
    await request(ctx.app).get('/health').expect(200, { status: 'ok' });
    expectError(await request(ctx.app).get('/api/v1/nope'), 404, 'NOT_FOUND');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await request(ctx.app)
      .post(AUCTIONS)
      .set(bearer(sellerToken))
      .set('Content-Type', 'application/json')
      .send('{not json');

    expectError(response, 400, 'INVALID_JSON');
  });
});
