// Task A-17: wallet, simulated deposit, history, the internal funds check and wallet creation from
// user.registered. Everything runs on a real Postgres built from database/payment.
import { randomUUID } from 'node:crypto';
import { createEvent } from '@auction/shared-common';
import { Client } from 'pg';
import request from 'supertest';
import { depositIntoWallet } from '../repositories/wallet.repository';
import {
  ADMIN_ID,
  BIDDER2_ID,
  BIDDER_ID,
  BIDDER_START_CENTS,
  SELLER_ID,
  SELLER_START_CENTS,
  createTestContext,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let bidderToken: string;
let sellerToken: string;
let adminToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  bidderToken = ctx.tokenFor(['BIDDER'], BIDDER_ID);
  sellerToken = ctx.tokenFor(['BIDDER', 'SELLER'], SELLER_ID);
  adminToken = ctx.tokenFor(['ADMIN'], ADMIN_ID);
});

afterAll(async () => {
  await ctx.close();
});

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function getWallet(token: string) {
  return request(ctx.app).get('/api/v1/wallet/me').set(auth(token));
}

function deposit(token: string, body: unknown) {
  return request(ctx.app)
    .post('/api/v1/wallet/deposit')
    .set(auth(token))
    .send(body as object);
}

function transactions(token: string, query = '') {
  return request(ctx.app).get(`/api/v1/wallet/transactions${query}`).set(auth(token));
}

function fundsCheck(query: string) {
  return request(ctx.app).get(`/internal/funds-check${query}`);
}

async function balanceOf(userId: string): Promise<number | undefined> {
  const { rows } = await ctx.pool.query<{ balance_cents: string }>(
    'SELECT balance_cents FROM wallets WHERE user_id = $1',
    [userId],
  );
  return rows[0] ? Number(rows[0].balance_cents) : undefined;
}

async function walletCount(userId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ count: string }>(
    'SELECT count(*) FROM wallets WHERE user_id = $1',
    [userId],
  );
  return Number(rows[0]?.count);
}

/** A user with an empty wallet of their own, so tests do not depend on each other's balances. */
async function freshUser(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = ctx.tokenFor(['BIDDER'], id);
  await getWallet(token).expect(200);
  return { id, token };
}

describe('GET /wallet/me', () => {
  it('shows the caller their own wallet', async () => {
    const response = await getWallet(bidderToken);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: '40000000-0000-4000-8000-000000000003',
      userId: BIDDER_ID,
      balanceCents: BIDDER_START_CENTS,
      currency: 'EUR',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('shows each user only their own wallet', async () => {
    const response = await getWallet(sellerToken).expect(200);

    expect(response.body).toMatchObject({ userId: SELLER_ID, balanceCents: SELLER_START_CENTS });
  });

  it('creates an empty wallet once when user.registered never arrived (Q11)', async () => {
    const userId = randomUUID();
    const token = ctx.tokenFor(['BIDDER'], userId);

    const [first, second] = await Promise.all([getWallet(token), getWallet(token)]);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ userId, balanceCents: 0, currency: 'EUR' });
    expect(second.body.id).toBe(first.body.id);
    expect(await walletCount(userId)).toBe(1);
  });

  it('answers 401 without a token and 403 for an admin-only account (Q13)', async () => {
    expectError(await request(ctx.app).get('/api/v1/wallet/me'), 401, 'UNAUTHORIZED');
    expectError(await getWallet(adminToken), 403, 'FORBIDDEN');
    expectError(await getWallet('not-a-jwt'), 401, 'UNAUTHORIZED');
  });
});

describe('POST /wallet/deposit', () => {
  it('adds the amount and answers with the new balance and its ledger row', async () => {
    const response = await deposit(sellerToken, { amountCents: 2550 });

    expect(response.status).toBe(200);
    expect(response.body.wallet).toMatchObject({
      userId: SELLER_ID,
      balanceCents: SELLER_START_CENTS + 2550,
    });
    expect(response.body.transaction).toEqual({
      id: expect.any(String),
      type: 'DEPOSIT',
      amountCents: 2550,
      balanceAfterCents: SELLER_START_CENTS + 2550,
      settlementId: null,
      createdAt: expect.any(String),
    });
    expect(await balanceOf(SELLER_ID)).toBe(SELLER_START_CENTS + 2550);
  });

  it('accepts exactly the limits: 1 cent and 10,000.00 (Q12)', async () => {
    const user = await freshUser();

    await deposit(user.token, { amountCents: 1 }).expect(200);
    await deposit(user.token, { amountCents: 1_000_000 }).expect(200);

    expect(await balanceOf(user.id)).toBe(1_000_001);
  });

  it.each([
    ['zero', { amountCents: 0 }],
    ['negative', { amountCents: -500 }],
    ['a fraction of a cent', { amountCents: 10.5 }],
    ['a string', { amountCents: '100' }],
    ['over the limit', { amountCents: 1_000_001 }],
    ['missing', {}],
    ['with an unknown field', { amountCents: 100, walletId: randomUUID() }],
  ])('refuses an amount that is %s, and changes nothing', async (_label, body) => {
    const user = await freshUser();

    const response = await deposit(user.token, body);

    expectError(response, 400, 'VALIDATION_ERROR');
    expect(await balanceOf(user.id)).toBe(0);
  });

  it('answers 401 without a token and 403 for an admin-only account', async () => {
    const response = await request(ctx.app)
      .post('/api/v1/wallet/deposit')
      .send({ amountCents: 100 });
    expectError(response, 401, 'UNAUTHORIZED');
    expectError(await deposit(adminToken, { amountCents: 100 }), 403, 'FORBIDDEN');
    expect(await balanceOf(ADMIN_ID)).toBe(0);
  });

  it('loses nothing under parallel deposits, and every row records its own balance', async () => {
    const user = await freshUser();

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => deposit(user.token, { amountCents: 100 })),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await balanceOf(user.id)).toBe(2000);
    const after = responses.map((r) => r.body.transaction.balanceAfterCents as number);
    expect([...after].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i + 1) * 100),
    );
  });

  it('dates a ledger row by when it got the lock, not when its transaction began', async () => {
    const user = await freshUser();
    const { rows } = await ctx.pool.query<{ id: string }>(
      'SELECT id FROM wallets WHERE user_id = $1',
      [user.id],
    );
    const walletId = rows[0]?.id as string;
    // "early" begins first, but "late" takes the lock and deposits first.
    const connection = (ctx.pool as unknown as { options: { connectionString: string } }).options;
    const early = new Client({ connectionString: connection.connectionString });
    await early.connect();
    try {
      await early.query('BEGIN');
      await early.query('SELECT now()');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await depositIntoWallet(ctx.pool, walletId, 100);
      await depositIntoWallet(early, walletId, 100);
      await early.query('COMMIT');
    } finally {
      await early.end();
    }

    const history = await transactions(user.token).expect(200);
    // Newest first: the newest row must show the highest balance.
    expect(
      history.body.data.map((t: { balanceAfterCents: number }) => t.balanceAfterCents),
    ).toEqual([200, 100]);
  });
});

describe('GET /wallet/transactions', () => {
  it('lists the caller own ledger, newest first, in the standard page shape', async () => {
    const user = await freshUser();
    for (const amountCents of [100, 200, 300]) {
      await deposit(user.token, { amountCents }).expect(200);
    }

    const response = await transactions(user.token);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 20, total: 3 });
    expect(response.body.data.map((t: { amountCents: number }) => t.amountCents)).toEqual([
      300, 200, 100,
    ]);
    expect(response.body.data[0]).toMatchObject({ type: 'DEPOSIT', balanceAfterCents: 600 });
  });

  it('pages without repeating or skipping a row', async () => {
    const user = await freshUser();
    for (let i = 1; i <= 5; i += 1) {
      await deposit(user.token, { amountCents: i }).expect(200);
    }

    const pages = await Promise.all(
      [1, 2, 3].map((page) => transactions(user.token, `?page=${page}&size=2`)),
    );

    expect(pages.map((p) => p.body.data.length)).toEqual([2, 2, 1]);
    const ids = pages.flatMap((p) => p.body.data.map((t: { id: string }) => t.id));
    expect(new Set(ids).size).toBe(5);
    expect(pages[2]?.body).toMatchObject({ page: 3, size: 2, total: 5 });
  });

  it('never shows another user entries', async () => {
    const user = await freshUser();
    await deposit(bidderToken, { amountCents: 777 }).expect(200);

    const response = await transactions(user.token).expect(200);

    expect(response.body).toMatchObject({ data: [], total: 0 });
  });

  it.each([['?size=101'], ['?page=0'], ['?size=abc'], ['?sort=amount']])(
    'refuses %s with 400',
    async (query) => {
      expectError(await transactions(bidderToken, query), 400, 'VALIDATION_ERROR');
    },
  );

  it('answers 401 without a token and 403 for an admin-only account', async () => {
    expectError(await request(ctx.app).get('/api/v1/wallet/transactions'), 401, 'UNAUTHORIZED');
    expectError(await transactions(adminToken), 403, 'FORBIDDEN');
  });
});

describe('GET /internal/funds-check (Q10)', () => {
  it('says whether the balance covers the amount, with the exact balance as the boundary', async () => {
    const enough = await fundsCheck(`?userId=${BIDDER2_ID}&amountCents=${BIDDER_START_CENTS}`);
    const tooMuch = await fundsCheck(`?userId=${BIDDER2_ID}&amountCents=${BIDDER_START_CENTS + 1}`);

    expect(enough.status).toBe(200);
    expect(enough.body).toEqual({
      userId: BIDDER2_ID,
      amountCents: BIDDER_START_CENTS,
      balanceCents: BIDDER_START_CENTS,
      sufficient: true,
    });
    expect(tooMuch.status).toBe(200);
    expect(tooMuch.body).toMatchObject({ sufficient: false });
  });

  it('only reads: it never moves or holds money', async () => {
    await fundsCheck(`?userId=${BIDDER2_ID}&amountCents=500`).expect(200);

    expect(await balanceOf(BIDDER2_ID)).toBe(BIDDER_START_CENTS);
  });

  it('answers 404 WALLET_NOT_FOUND for a user without a wallet, and does not create one', async () => {
    const userId = randomUUID();

    expectError(await fundsCheck(`?userId=${userId}&amountCents=100`), 404, 'WALLET_NOT_FOUND');
    expect(await walletCount(userId)).toBe(0);
  });

  it('cannot be used to read the platform wallet', async () => {
    // The platform wallet has no user; a nil UUID is the closest a caller could get.
    expectError(
      await fundsCheck('?userId=00000000-0000-0000-0000-000000000000&amountCents=1'),
      404,
      'WALLET_NOT_FOUND',
    );
  });

  it.each([
    ['a bad user ID', '?userId=abc&amountCents=100'],
    ['a zero amount', `?userId=${BIDDER_ID}&amountCents=0`],
    ['a fractional amount', `?userId=${BIDDER_ID}&amountCents=1.5`],
    ['a text amount', `?userId=${BIDDER_ID}&amountCents=lots`],
    ['no amount', `?userId=${BIDDER_ID}`],
    ['an unknown parameter', `?userId=${BIDDER_ID}&amountCents=1&currency=USD`],
  ])('refuses %s with 400', async (_label, query) => {
    expectError(await fundsCheck(query), 400, 'VALIDATION_ERROR');
  });

  it('is not part of the public API', async () => {
    const response = await request(ctx.app).get(
      `/api/v1/internal/funds-check?userId=${BIDDER_ID}&amountCents=1`,
    );
    expectError(response, 404, 'NOT_FOUND');
  });
});

describe('consuming user.registered', () => {
  function registered(userId: string) {
    return createEvent('user.registered', { userId, displayName: 'New User' });
  }

  it('creates an empty wallet in the platform currency', async () => {
    const userId = randomUUID();

    await ctx.handlers['user.registered']?.(registered(userId));

    const response = await getWallet(ctx.tokenFor(['BIDDER'], userId)).expect(200);
    expect(response.body).toMatchObject({ userId, balanceCents: 0, currency: 'EUR' });
  });

  it('changes nothing when the event is delivered again, even in parallel', async () => {
    const userId = randomUUID();
    const event = registered(userId);
    await ctx.handlers['user.registered']?.(event);
    await deposit(ctx.tokenFor(['BIDDER'], userId), { amountCents: 900 }).expect(200);

    await Promise.all(Array.from({ length: 5 }, () => ctx.handlers['user.registered']?.(event)));

    expect(await walletCount(userId)).toBe(1);
    expect(await balanceOf(userId)).toBe(900);
  });
});

describe('the ledger explains every balance', () => {
  it('balance equals the sum of ledger rows for every wallet, after all the tests above', async () => {
    const { rows } = await ctx.pool.query<{ user_id: string | null; mismatch: boolean }>(
      `SELECT w.user_id, w.balance_cents <> COALESCE(sum(l.amount_cents), 0) AS mismatch
       FROM wallets w LEFT JOIN ledger_entries l ON l.wallet_id = w.id
       GROUP BY w.id`,
    );

    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => row.mismatch)).toEqual([]);
  });
});
