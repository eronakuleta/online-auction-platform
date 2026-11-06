// Task A-26: GET /auctions/mine, the seller dashboard's list, on a real Postgres.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestContext, newAuction, type TestContext } from './helpers';

let ctx: TestContext;
let sellerToken: string;
let otherSellerToken: string;

const AUCTIONS = '/api/v1/auctions';
const MINE = '/api/v1/auctions/mine';

beforeAll(async () => {
  ctx = await createTestContext();
  sellerToken = ctx.tokenFor(['BIDDER', 'SELLER'], randomUUID());
  otherSellerToken = ctx.tokenFor(['SELLER'], randomUUID());
});

afterAll(async () => {
  await ctx.close();
});

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function create(token: string, title: string): Promise<string> {
  const response = await request(ctx.app)
    .post(AUCTIONS)
    .set(auth(token))
    .send(newAuction({ title, reservePriceCents: 4000 }))
    .expect(201);
  return response.body.id as string;
}

describe('GET /auctions/mine', () => {
  let draftId: string;
  let publishedId: string;
  let cancelledId: string;

  beforeAll(async () => {
    draftId = await create(sellerToken, 'My draft');
    publishedId = await create(sellerToken, 'My published');
    await request(ctx.app).post(`${AUCTIONS}/${publishedId}/publish`).set(auth(sellerToken));
    cancelledId = await create(sellerToken, 'My cancelled draft');
    await request(ctx.app).post(`${AUCTIONS}/${cancelledId}/cancel`).set(auth(sellerToken));
    await create(otherSellerToken, 'Not mine');
  });

  it('lists only the caller own auctions in every state, newest first, with reserve prices', async () => {
    const response = await request(ctx.app).get(MINE).set(auth(sellerToken));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 20, total: 3 });
    expect(response.body.data.map((a: { id: string }) => a.id)).toEqual([
      cancelledId,
      publishedId,
      draftId,
    ]);
    expect(response.body.data.map((a: { status: string }) => a.status)).toEqual([
      'CANCELLED',
      'PUBLISHED',
      'DRAFT',
    ]);
    // The seller sees their own reserve price (decision Q8).
    expect(response.body.data[0].reservePriceCents).toBe(4000);
  });

  it('includes drafts, which the public catalog never shows', async () => {
    const catalog = await request(ctx.app).get(`${AUCTIONS}?size=100`).set(auth(sellerToken));

    expect(catalog.body.data.map((a: { id: string }) => a.id)).not.toContain(draftId);
  });

  it('filters by status, DRAFT included', async () => {
    const drafts = await request(ctx.app).get(`${MINE}?status=DRAFT`).set(auth(sellerToken));

    expect(drafts.status).toBe(200);
    expect(drafts.body).toMatchObject({ total: 1, data: [{ id: draftId }] });
  });

  it('pages without repeating a row', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        request(ctx.app).get(`${MINE}?page=${page}&size=1`).set(auth(sellerToken)),
      ),
    );

    const ids = pages.map((p) => p.body.data[0]?.id as string);
    expect(new Set(ids).size).toBe(3);
    expect(pages[2]?.body).toMatchObject({ page: 3, size: 1, total: 3 });
  });

  it('gives a seller without auctions an empty page, not an error', async () => {
    const response = await request(ctx.app)
      .get(MINE)
      .set(auth(ctx.tokenFor(['SELLER'])));

    expect(response.body).toMatchObject({ data: [], total: 0 });
  });

  it.each([['?status=OPEN'], ['?size=101'], ['?page=0'], ['?sellerId=someone']])(
    'refuses %s with 400',
    async (query) => {
      expectError(
        await request(ctx.app).get(`${MINE}${query}`).set(auth(sellerToken)),
        400,
        'VALIDATION_ERROR',
      );
    },
  );

  it('answers 401 without a token and 403 for bidders and admins', async () => {
    expectError(await request(ctx.app).get(MINE), 401, 'UNAUTHORIZED');
    expectError(
      await request(ctx.app)
        .get(MINE)
        .set(auth(ctx.tokenFor(['BIDDER']))),
      403,
      'FORBIDDEN',
    );
    expectError(
      await request(ctx.app)
        .get(MINE)
        .set(auth(ctx.tokenFor(['ADMIN']))),
      403,
      'FORBIDDEN',
    );
  });

  it('is not mistaken for an auction ID by GET /auctions/:id', async () => {
    // Without a token the route still exists and asks for one, instead of answering 400 for a
    // malformed auction ID.
    expectError(await request(ctx.app).get(MINE), 401, 'UNAUTHORIZED');
  });
});
