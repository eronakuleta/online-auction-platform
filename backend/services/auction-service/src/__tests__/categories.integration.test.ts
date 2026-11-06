// Task A-14: GET /categories, GET /categories/:id and POST /categories (ADMIN), on a real Postgres.
// The list tests run first, while only the six seeded categories exist.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CATEGORY_ID, createTestContext, newAuction, type TestContext } from './helpers';

let ctx: TestContext;
let adminToken: string;
let sellerToken: string;
let bidderToken: string;

const CATEGORIES = '/api/v1/categories';
const SEEDED_NAMES = ['Art', 'Collectibles', 'Electronics', 'Fashion', 'Home and Garden', 'Sports'];

beforeAll(async () => {
  ctx = await createTestContext();
  adminToken = ctx.tokenFor(['ADMIN']);
  sellerToken = ctx.tokenFor(['BIDDER', 'SELLER']);
  bidderToken = ctx.tokenFor(['BIDDER']);
});

afterAll(async () => {
  await ctx.close();
});

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

function create(token: string | undefined, body: unknown) {
  const call = request(ctx.app).post(CATEGORIES);
  if (token) {
    call.set({ Authorization: `Bearer ${token}` });
  }
  return call.send(body as object);
}

/** A name no other test uses, so tests do not collide. */
function uniqueName(prefix = 'Category'): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe('GET /categories', () => {
  it('lists every category alphabetically for anyone, without a token', async () => {
    const response = await request(ctx.app).get(CATEGORIES);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 100, total: 6 });
    expect(response.body.data.map((c: { name: string }) => c.name)).toEqual(SEEDED_NAMES);
    expect(response.body.data[0]).toEqual({
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Art',
      createdAt: expect.any(String),
    });
  });

  it('pages in the standard shape', async () => {
    const response = await request(ctx.app).get(`${CATEGORIES}?page=2&size=2`).expect(200);

    expect(response.body).toMatchObject({ page: 2, size: 2, total: 6 });
    expect(response.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Electronics',
      'Fashion',
    ]);
  });

  it.each([['?size=101'], ['?page=0'], ['?size=two'], ['?sort=name']])(
    'refuses %s with 400',
    async (query) => {
      expectError(await request(ctx.app).get(`${CATEGORIES}${query}`), 400, 'VALIDATION_ERROR');
    },
  );
});

describe('GET /categories/:id', () => {
  it('shows one category', async () => {
    const response = await request(ctx.app).get(`${CATEGORIES}/${CATEGORY_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: CATEGORY_ID, name: 'Electronics' });
  });

  it('answers 404 for an unknown ID and 400 for an invalid one', async () => {
    expectError(await request(ctx.app).get(`${CATEGORIES}/${randomUUID()}`), 404, 'NOT_FOUND');
    expectError(await request(ctx.app).get(`${CATEGORIES}/abc`), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /categories', () => {
  it('lets an admin create a category, with a Location to read it back', async () => {
    const name = uniqueName('Books');

    const response = await create(adminToken, { name: `  ${name}  ` });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: expect.any(String), name, createdAt: expect.any(String) });
    expect(response.headers.location).toBe(`${CATEGORIES}/${response.body.id}`);
    const readBack = await request(ctx.app).get(`${CATEGORIES}/${response.body.id}`).expect(200);
    expect(readBack.body.name).toBe(name);
  });

  it('makes the new category usable for auctions right away', async () => {
    const category = await create(adminToken, { name: uniqueName('Toys') }).expect(201);

    await request(ctx.app)
      .post('/api/v1/auctions')
      .set({ Authorization: `Bearer ${sellerToken}` })
      .send(newAuction({ categoryId: category.body.id }))
      .expect(201);
  });

  it.each([['art'], ['ART'], ['  Art ']])(
    'refuses "%s" with 409, because "Art" exists (case does not matter)',
    async (name) => {
      expectError(await create(adminToken, { name }), 409, 'CATEGORY_EXISTS');
    },
  );

  it('lets only one of several parallel requests for the same name succeed', async () => {
    const name = uniqueName('Music');

    const responses = await Promise.all(
      [name, name.toUpperCase(), name, name.toLowerCase(), name].map((n) =>
        create(adminToken, { name: n }),
      ),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const { rows } = await ctx.pool.query('SELECT 1 FROM categories WHERE lower(name) = $1', [
      name.toLowerCase(),
    ]);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['too short', { name: 'A' }],
    ['only spaces', { name: '     ' }],
    ['too long', { name: 'x'.repeat(61) }],
    ['not text', { name: 42 }],
    ['missing', {}],
    ['with a NUL character', { name: 'Bad\0name' }],
    ['with an unknown field', { name: uniqueName(), id: randomUUID() }],
  ])('refuses a name that is %s with 400', async (_label, body) => {
    expectError(await create(adminToken, body), 400, 'VALIDATION_ERROR');
  });

  it('accepts names of exactly 2 and 60 characters', async () => {
    await create(adminToken, { name: 'Zz' }).expect(201);
    await create(adminToken, { name: `${uniqueName()}${'y'.repeat(43)}` }).expect(201);
  });

  it('answers 401 without a token and 403 for sellers and bidders, and creates nothing', async () => {
    const name = uniqueName('Forbidden');

    expectError(await create(undefined, { name }), 401, 'UNAUTHORIZED');
    expectError(await create(sellerToken, { name }), 403, 'FORBIDDEN');
    expectError(await create(bidderToken, { name }), 403, 'FORBIDDEN');

    const { rows } = await ctx.pool.query('SELECT 1 FROM categories WHERE name = $1', [name]);
    expect(rows).toHaveLength(0);
  });
});
