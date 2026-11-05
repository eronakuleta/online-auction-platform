import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createTestContext, newUser, type TestContext } from './helpers';

let ctx: TestContext;
let adminToken: string;
let bidderToken: string;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const USERS = '/api/v1/users';
const SEEDED_ADMIN_ID = '00000000-0000-4000-8000-000000000001';

async function login(email: string, password: string) {
  const response = await request(ctx.app).post(LOGIN).send({ email, password }).expect(200);
  return response.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
  adminToken = (await login('admin@auction.test', 'Admin#Demo2026')).accessToken;
  bidderToken = (await login('bidder1@auction.test', 'Bidder#Demo2026')).accessToken;
});

afterAll(async () => {
  await ctx.close();
});

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

async function registerUser() {
  const body = newUser();
  const response = await request(ctx.app).post(REGISTER).send(body).expect(201);
  return { ...body, id: response.body.id as string };
}

function asAdmin(call: request.Test): request.Test {
  return call.set('Authorization', `Bearer ${adminToken}`);
}

function setStatus(id: string, status: unknown) {
  return asAdmin(request(ctx.app).patch(`${USERS}/${id}/status`)).send({ status });
}

function setRoles(id: string, roles: unknown) {
  return asAdmin(request(ctx.app).patch(`${USERS}/${id}/roles`)).send({ roles });
}

describe('user.registered event', () => {
  it('is published after registration with the contract payload and no email', async () => {
    const user = await registerUser();

    const event = ctx.published.find(
      (e) => e.type === 'user.registered' && e.payload.userId === user.id,
    );
    expect(event?.payload).toEqual({ userId: user.id, displayName: user.displayName });
    expect(JSON.stringify(event)).not.toContain(user.email);
  });

  it('is not published when the email is taken', async () => {
    const user = await registerUser();
    const body = { email: user.email, password: user.password, displayName: user.displayName };
    const before = ctx.published.length;

    await request(ctx.app).post(REGISTER).send(body).expect(409);

    expect(ctx.published).toHaveLength(before);
  });

  it('still answers 201 and keeps the account if the broker fails', async () => {
    const body = newUser();
    ctx.failNextPublish();

    await request(ctx.app).post(REGISTER).send(body).expect(201);

    await request(ctx.app)
      .post(LOGIN)
      .send({ email: body.email, password: body.password })
      .expect(200);
  });
});

describe('GET /users', () => {
  it('returns the standard page shape without password hashes', async () => {
    const response = await asAdmin(request(ctx.app).get(USERS)).query({ page: 1, size: 2 });

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(1);
    expect(response.body.size).toBe(2);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.total).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(response.body)).not.toMatch(/argon2|passwordHash/);
  });

  it('uses page 1 and size 20 by default', async () => {
    const response = await asAdmin(request(ctx.app).get(USERS));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, size: 20 });
  });

  it('pages through users without repeats, whatever the page size', async () => {
    const first = await asAdmin(request(ctx.app).get(USERS)).query({ page: 1, size: 2 });
    const second = await asAdmin(request(ctx.app).get(USERS)).query({ page: 2, size: 2 });

    const ids = [...first.body.data, ...second.body.data].map((u: { id: string }) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty page past the end, with the right total', async () => {
    const response = await asAdmin(request(ctx.app).get(USERS)).query({ page: 9999 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.total).toBeGreaterThanOrEqual(4);
  });

  it('filters by status', async () => {
    const user = await registerUser();
    await setStatus(user.id, 'BANNED').expect(200);

    const response = await asAdmin(request(ctx.app).get(USERS)).query({
      status: 'BANNED',
      size: 100,
    });

    expect(response.status).toBe(200);
    const users = response.body.data as { id: string; status: string }[];
    expect(users.map((u) => u.id)).toContain(user.id);
    expect(users.every((u) => u.status === 'BANNED')).toBe(true);
    expect(response.body.total).toBe(users.length);
  });

  it.each([
    ['size above 100', { size: 101 }],
    ['size 0', { size: 0 }],
    ['page 0', { page: 0 }],
    ['a page that is not a number', { page: 'abc' }],
    ['a decimal page', { page: 1.5 }],
    ['an unknown status', { status: 'DELETED' }],
    ['an unknown parameter', { sort: 'email' }],
    ['SQL in a parameter', { status: "ACTIVE' OR '1'='1" }],
  ])('answers 400 for %s', async (_case, query) => {
    const response = await asAdmin(request(ctx.app).get(USERS)).query(query);
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 401 without a token and 403 for a non-admin', async () => {
    expectError(await request(ctx.app).get(USERS), 401, 'UNAUTHORIZED');
    expectError(
      await request(ctx.app).get(USERS).set('Authorization', `Bearer ${bidderToken}`),
      403,
      'FORBIDDEN',
    );
  });
});

describe('PATCH /users/:id/status', () => {
  it('bans: login and refresh stop working, everywhere', async () => {
    const user = await registerUser();
    const phone = await login(user.email, user.password);
    const laptop = await login(user.email, user.password);

    const response = await setStatus(user.id, 'BANNED');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('BANNED');
    expectError(
      await request(ctx.app).post(LOGIN).send({ email: user.email, password: user.password }),
      401,
      'INVALID_CREDENTIALS',
    );
    for (const session of [phone, laptop]) {
      expectError(
        await request(ctx.app).post(REFRESH).send({ refreshToken: session.refreshToken }),
        401,
        'INVALID_REFRESH_TOKEN',
      );
    }
  });

  it('unbans: the user can log in again, but old sessions stay ended', async () => {
    const user = await registerUser();
    const session = await login(user.email, user.password);
    await setStatus(user.id, 'BANNED').expect(200);

    const response = await setStatus(user.id, 'ACTIVE');

    expect(response.body.status).toBe('ACTIVE');
    await login(user.email, user.password);
    expectError(
      await request(ctx.app).post(REFRESH).send({ refreshToken: session.refreshToken }),
      401,
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('can be repeated with the same status', async () => {
    const user = await registerUser();

    await setStatus(user.id, 'BANNED').expect(200);
    await setStatus(user.id, 'BANNED').expect(200);
  });

  it('refuses to ban an admin (Q6), including yourself', async () => {
    expectError(await setStatus(SEEDED_ADMIN_ID, 'BANNED'), 409, 'ADMIN_ACCOUNT_PROTECTED');
    await login('admin@auction.test', 'Admin#Demo2026');
  });

  it.each([
    ['an unknown status', { status: 'DELETED' }],
    ['no status', {}],
    ['an extra field', { status: 'BANNED', reason: 'spam' }],
  ])('answers 400 for %s', async (_case, body) => {
    const user = await registerUser();
    const response = await asAdmin(request(ctx.app).patch(`${USERS}/${user.id}/status`)).send(body);
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 400 for an ID that is not a UUID', async () => {
    expectError(await setStatus('not-a-uuid', 'BANNED'), 400, 'VALIDATION_ERROR');
  });

  it('answers 404 for an unknown user', async () => {
    expectError(await setStatus(randomUUID(), 'BANNED'), 404, 'NOT_FOUND');
  });

  it('answers 401 without a token and 403 for a non-admin, and changes nothing', async () => {
    const user = await registerUser();
    const url = `${USERS}/${user.id}/status`;

    expectError(await request(ctx.app).patch(url).send({ status: 'BANNED' }), 401, 'UNAUTHORIZED');
    expectError(
      await request(ctx.app)
        .patch(url)
        .set('Authorization', `Bearer ${bidderToken}`)
        .send({ status: 'BANNED' }),
      403,
      'FORBIDDEN',
    );
    await login(user.email, user.password);
  });
});

describe('PATCH /users/:id/roles', () => {
  it('grants SELLER, which reaches the token at the next refresh (Q1)', async () => {
    const user = await registerUser();
    const session = await login(user.email, user.password);

    const response = await setRoles(user.id, ['BIDDER', 'SELLER']);

    expect(response.status).toBe(200);
    expect(response.body.roles).toEqual(['BIDDER', 'SELLER']);
    expect((jwt.decode(session.accessToken) as jwt.JwtPayload).roles).toEqual(['BIDDER']);

    const refreshed = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect((jwt.decode(refreshed.body.accessToken) as jwt.JwtPayload).roles).toEqual([
      'BIDDER',
      'SELLER',
    ]);
  });

  it('replaces the whole list: a role left out is removed', async () => {
    const user = await registerUser();
    await setRoles(user.id, ['BIDDER', 'SELLER']).expect(200);

    const response = await setRoles(user.id, ['SELLER']);

    expect(response.body.roles).toEqual(['SELLER']);
    const { rows } = await ctx.pool.query('SELECT role FROM user_roles WHERE user_id = $1', [
      user.id,
    ]);
    expect(rows).toEqual([{ role: 'SELLER' }]);
  });

  it('keeps sessions alive, unlike a ban', async () => {
    const user = await registerUser();
    const session = await login(user.email, user.password);

    await setRoles(user.id, ['SELLER']).expect(200);

    await request(ctx.app).post(REFRESH).send({ refreshToken: session.refreshToken }).expect(200);
  });

  it('applies parallel changes one at a time, ending in one of the requested lists', async () => {
    const user = await registerUser();

    const responses = await Promise.all([
      setRoles(user.id, ['BIDDER']),
      setRoles(user.id, ['SELLER']),
      setRoles(user.id, ['BIDDER', 'SELLER']),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const { rows } = await ctx.pool.query<{ role: string }>(
      'SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role',
      [user.id],
    );
    expect([['BIDDER'], ['SELLER'], ['BIDDER', 'SELLER']]).toContainEqual(rows.map((r) => r.role));
  });

  it('refuses to change an admin (Q6)', async () => {
    expectError(await setRoles(SEEDED_ADMIN_ID, ['BIDDER']), 409, 'ADMIN_ACCOUNT_PROTECTED');
  });

  it.each([
    ['granting ADMIN (Q6)', ['ADMIN']],
    ['an unknown role', ['SUPERUSER']],
    ['an empty list', []],
    ['a repeated role', ['BIDDER', 'BIDDER']],
    ['something that is not a list', 'SELLER'],
  ])('answers 400 for %s', async (_case, roles) => {
    const user = await registerUser();
    expectError(await setRoles(user.id, roles), 400, 'VALIDATION_ERROR');
  });

  it('answers 400 for an extra field', async () => {
    const user = await registerUser();
    const response = await asAdmin(request(ctx.app).patch(`${USERS}/${user.id}/roles`)).send({
      roles: ['SELLER'],
      status: 'BANNED',
    });
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 400 for a bad ID and 404 for an unknown user', async () => {
    expectError(await setRoles('not-a-uuid', ['SELLER']), 400, 'VALIDATION_ERROR');
    expectError(await setRoles(randomUUID(), ['SELLER']), 404, 'NOT_FOUND');
  });

  it('answers 401 without a token and 403 for a non-admin', async () => {
    const user = await registerUser();
    const url = `${USERS}/${user.id}/roles`;

    expectError(
      await request(ctx.app)
        .patch(url)
        .send({ roles: ['SELLER'] }),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await request(ctx.app)
        .patch(url)
        .set('Authorization', `Bearer ${bidderToken}`)
        .send({ roles: ['SELLER'] }),
      403,
      'FORBIDDEN',
    );
  });

  it('stops a bidder from promoting themselves', async () => {
    const user = await registerUser();
    const session = await login(user.email, user.password);

    const response = await request(ctx.app)
      .patch(`${USERS}/${user.id}/roles`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ roles: ['SELLER'] });

    expectError(response, 403, 'FORBIDDEN');
  });
});
