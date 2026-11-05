import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CATEGORY_ID,
  OTHER_CATEGORY_ID,
  SEEDED_DRAFT_ID,
  SEEDED_LIVE_ID,
  createTestContext,
  newAuction,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let sellerToken: string;

const AUCTIONS = '/api/v1/auctions';

beforeAll(async () => {
  ctx = await createTestContext();
  sellerToken = ctx.tokenFor(['SELLER']);
});

afterAll(async () => {
  await ctx.close();
});

interface ListedAuction {
  id: string;
  title: string;
  status: string;
  categoryId: string;
  startingPriceCents: number;
  reservePriceCents?: number | null;
}

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

function list(query: Record<string, unknown> = {}, token?: string) {
  const call = request(ctx.app).get(AUCTIONS).query(query);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

/**
 * Creates and publishes an auction whose title contains `tag`, a word no other test uses, so each
 * test can search for exactly its own rows.
 */
async function published(tag: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(ctx.app)
    .post(AUCTIONS)
    .set('Authorization', `Bearer ${sellerToken}`)
    .send(newAuction({ title: `${tag} item`, ...overrides }))
    .expect(201);
  const id = response.body.id as string;
  await request(ctx.app)
    .post(`${AUCTIONS}/${id}/publish`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .expect(200);
  return id;
}

/** A unique search word: letters only, so the English stemmer leaves it unchanged. */
function uniqueTag(): string {
  return `tag${randomUUID()
    .replace(/[^a-f]/g, '')
    .slice(0, 10)}`;
}

function ids(response: request.Response): string[] {
  return (response.body.data as ListedAuction[]).map((auction) => auction.id);
}

describe('GET /auctions', () => {
  it('returns the standard page shape, without reserve prices for visitors', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 20 });
    expect(response.body.total).toBeGreaterThanOrEqual(3);
    const auctions = response.body.data as ListedAuction[];
    expect(auctions.every((auction) => auction.status === 'PUBLISHED')).toBe(true);
    expect(auctions.some((auction) => 'reservePriceCents' in auction)).toBe(false);
    expect(ids(response)).toContain(SEEDED_LIVE_ID);
  });

  it('never lists drafts, nor drafts that were cancelled', async () => {
    const tag = uniqueTag();
    const draft = await request(ctx.app)
      .post(AUCTIONS)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(newAuction({ title: `${tag} draft` }))
      .expect(201);
    await request(ctx.app)
      .post(`${AUCTIONS}/${draft.body.id}/cancel`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    for (const status of ['PUBLISHED', 'CANCELLED']) {
      const response = await list({ q: tag, status }, sellerToken);
      expect(response.body.total).toBe(0);
    }
    expect(ids(await list({ size: 100 }))).not.toContain(SEEDED_DRAFT_ID);
  });

  it('lists a published auction that was cancelled, under CANCELLED', async () => {
    const tag = uniqueTag();
    const id = await published(tag);
    await request(ctx.app)
      .post(`${AUCTIONS}/${id}/cancel`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(ids(await list({ q: tag }))).toEqual([]);
    expect(ids(await list({ q: tag, status: 'CANCELLED' }))).toEqual([id]);
  });

  it('shows reserve prices only on the caller own auctions', async () => {
    const tag = uniqueTag();
    await published(tag);

    const own = await list({ q: tag }, sellerToken);
    const other = await list({ q: tag }, ctx.tokenFor(['SELLER']));

    expect((own.body.data as ListedAuction[])[0]?.reservePriceCents).toBe(2000);
    expect((other.body.data as ListedAuction[])[0]).not.toHaveProperty('reservePriceCents');
  });

  describe('search', () => {
    it('finds words in the title and description, with stemming', async () => {
      const tag = uniqueTag();
      const inTitle = await published(tag);
      const inDescription = await published(uniqueTag(), {
        description: `Comes with ${tag} and two cameras`,
      });

      const response = await list({ q: tag });
      expect(ids(response).sort()).toEqual([inTitle, inDescription].sort());

      const stemmed = await list({ q: `${tag} camera` });
      expect(ids(stemmed)).toEqual([inDescription]);
    });

    it('ranks the better match first, even when it is older', async () => {
      const tag = uniqueTag();
      // Created first, so "newest first" would put it last: only ranking puts it first.
      const strong = await published(tag, { description: `${tag} ${tag} ${tag}` });
      const weak = await published(uniqueTag(), { description: `${tag}` });

      const response = await list({ q: tag });

      expect(ids(response)).toEqual([strong, weak]);
    });

    it('understands quotes, OR and minus', async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const first = await published(`${a} red`);
      const second = await published(`${b} blue`);

      expect(ids(await list({ q: `${a} OR ${b}` })).sort()).toEqual([first, second].sort());
      expect(ids(await list({ q: `${a} -red` }))).toEqual([]);
      expect(ids(await list({ q: `"${a} red"` }))).toEqual([first]);
    });

    it.each([
      ['SQL in the term', "' OR 1=1; DROP TABLE auctions;--"],
      ['tsquery syntax characters', 'a & | ! ( ) : * <-> \\'],
      ['only stop words', 'the and of'],
      ['a lone quote', '"'],
    ])('treats %s as plain words: 200, no crash', async (_case, q) => {
      const response = await list({ q });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('filters', () => {
    it('filters by category', async () => {
      const tag = uniqueTag();
      const inCategory = await published(tag, { categoryId: OTHER_CATEGORY_ID });
      await published(tag, { categoryId: CATEGORY_ID });

      const response = await list({ q: tag, categoryId: OTHER_CATEGORY_ID });

      expect(ids(response)).toEqual([inCategory]);
      expect(response.body.total).toBe(1);
    });

    it('filters by status', async () => {
      const response = await list({ status: 'CLOSED_NO_SALE', size: 100 });

      const auctions = response.body.data as ListedAuction[];
      expect(auctions.length).toBeGreaterThanOrEqual(1);
      expect(auctions.every((auction) => auction.status === 'CLOSED_NO_SALE')).toBe(true);
    });

    it('filters by a price range on the starting price, both ends included', async () => {
      const tag = uniqueTag();
      const prices = [1000, 2000, 3000, 4000];
      const created = await Promise.all(
        prices.map((price) => published(tag, { startingPriceCents: price })),
      );

      const response = await list({ q: tag, minPriceCents: 2000, maxPriceCents: 3000 });

      expect(ids(response).sort()).toEqual([created[1], created[2]].sort());
      expect(ids(await list({ q: tag, minPriceCents: 3500 }))).toEqual([created[3]]);
      expect(ids(await list({ q: tag, maxPriceCents: 1000 }))).toEqual([created[0]]);
    });

    it('combines every filter, and total counts all matches, not only this page', async () => {
      const tag = uniqueTag();
      for (const price of [1500, 1600, 1700]) {
        await published(tag, { categoryId: OTHER_CATEGORY_ID, startingPriceCents: price });
      }
      await published(tag, { categoryId: OTHER_CATEGORY_ID, startingPriceCents: 9000 });
      await published(tag, { categoryId: CATEGORY_ID, startingPriceCents: 1500 });

      const response = await list({
        q: tag,
        categoryId: OTHER_CATEGORY_ID,
        maxPriceCents: 2000,
        size: 2,
      });

      expect(response.body.total).toBe(3);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('sorting and pages', () => {
    it.each([
      ['price_asc', [1000, 2000, 3000]],
      ['price_desc', [3000, 2000, 1000]],
    ])('sorts by %s', async (sort, expected) => {
      const tag = uniqueTag();
      for (const price of [2000, 3000, 1000]) {
        await published(tag, { startingPriceCents: price });
      }

      const response = await list({ q: tag, sort });

      const prices = (response.body.data as ListedAuction[]).map((a) => a.startingPriceCents);
      expect(prices).toEqual(expected);
    });

    it('sorts by ending_soon', async () => {
      const tag = uniqueTag();
      const day = 86_400_000;
      const later = await published(tag, { endsAt: new Date(Date.now() + 3 * day).toISOString() });
      const sooner = await published(tag, { endsAt: new Date(Date.now() + 2 * day).toISOString() });

      expect(ids(await list({ q: tag, sort: 'ending_soon' }))).toEqual([sooner, later]);
    });

    it('sorts by newest by default, without a search term', async () => {
      const tag = uniqueTag();
      const first = await published(tag);
      const second = await published(tag);

      expect(ids(await list({ q: tag, sort: 'newest' }))).toEqual([second, first]);
    });

    it('pages through equal prices without repeating or skipping a row', async () => {
      const tag = uniqueTag();
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        created.push(await published(tag, { startingPriceCents: 1000 }));
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) => list({ q: tag, sort: 'price_asc', size: 2, page })),
      );

      const seen = pages.flatMap(ids);
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(new Set(created));
      // Equal prices are ordered by id, so the order is fully defined, not left to chance.
      expect(seen).toEqual([...created].sort());
      expect(pages.map((p) => p.body.total)).toEqual([5, 5, 5]);
    });

    it('returns an empty page past the end, with the right total', async () => {
      const tag = uniqueTag();
      await published(tag);

      const response = await list({ q: tag, page: 99 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: [], page: 99, total: 1 });
    });
  });

  describe('invalid input', () => {
    it.each([
      ['size above 100', { size: 101 }],
      ['size 0', { size: 0 }],
      ['page 0', { page: 0 }],
      ['a page that is not a number', { page: 'two' }],
      ['a decimal page', { page: 1.5 }],
      ['a negative price', { minPriceCents: -1 }],
      ['a decimal price', { minPriceCents: 10.5 }],
      ['min above max', { minPriceCents: 3000, maxPriceCents: 2000 }],
      ['the DRAFT status', { status: 'DRAFT' }],
      ['an unknown status', { status: 'LIVE' }],
      ['an unknown sort', { sort: 'title' }],
      ['SQL as the sort', { sort: 'id; DROP TABLE auctions' }],
      ['relevance without a search term', { sort: 'relevance' }],
      ['a blank search term', { q: '   ' }],
      ['a search term over 100 characters', { q: 'x'.repeat(101) }],
      ['a NUL character in the search term', { q: 'bad\u0000term' }],
      ['a category that is not a UUID', { categoryId: 'art' }],
      ['an unknown parameter', { sellerId: randomUUID() }],
      ['a repeated parameter', { page: ['1', '2'] }],
    ])('answers 400 for %s', async (_case, query) => {
      expectError(await list(query), 400, 'VALIDATION_ERROR');
    });

    it('answers 401 for a bad token, instead of treating the caller as a visitor', async () => {
      expectError(
        await request(ctx.app).get(AUCTIONS).set('Authorization', 'Bearer a.b.c'),
        401,
        'UNAUTHORIZED',
      );
    });

    it('returns an empty list, not a 404, for a category with no auctions', async () => {
      const response = await list({ categoryId: randomUUID() });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: [], total: 0 });
    });
  });
});
