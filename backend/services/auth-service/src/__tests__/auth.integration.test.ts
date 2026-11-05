import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AUDIENCE, ISSUER, createTestContext, newUser, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';

function expectError(response: request.Response, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
}

async function registerAndLogin(overrides: Record<string, unknown> = {}) {
  const user = newUser(overrides);
  await request(ctx.app).post(REGISTER).send(user).expect(201);
  const login = await request(ctx.app)
    .post(LOGIN)
    .send({ email: user.email, password: user.password })
    .expect(200);
  return { user, tokens: login.body as { accessToken: string; refreshToken: string } };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('POST /auth/register', () => {
  it('creates a BIDDER and never returns the password hash', async () => {
    const body = newUser();
    const response = await request(ctx.app).post(REGISTER).send(body);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe('/api/v1/users/me');
    expect(response.body).toMatchObject({
      email: body.email,
      displayName: body.displayName,
      status: 'ACTIVE',
      roles: ['BIDDER'],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/argon2|password/i);
  });

  it('stores an argon2id hash, not the password', async () => {
    const body = newUser();
    await request(ctx.app).post(REGISTER).send(body).expect(201);

    const { rows } = await ctx.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [body.email],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('normalises the email', async () => {
    const response = await request(ctx.app)
      .post(REGISTER)
      .send(newUser({ email: '  MiXeD@Test.IO ' }));

    expect(response.status).toBe(201);
    expect(response.body.email).toBe('mixed@test.io');
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['a short password', { password: 'short' }],
    ['a password over 128 characters', { password: 'x'.repeat(129) }],
    ['a blank display name', { displayName: '   ' }],
    ['a display name over 100 characters', { displayName: 'x'.repeat(101) }],
  ])('answers 400 for %s', async (_case, override) => {
    const response = await request(ctx.app).post(REGISTER).send(newUser(override));
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 400 with the field name for a missing field', async () => {
    const response = await request(ctx.app).post(REGISTER).send({ email: 'a@test.io' });
    expectError(response, 400, 'VALIDATION_ERROR');
    const paths = (response.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['password', 'displayName']));
  });

  it('rejects a roles field, so nobody can make themselves a seller (Q1)', async () => {
    const response = await request(ctx.app)
      .post(REGISTER)
      .send(newUser({ roles: ['ADMIN'] }));
    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await request(ctx.app)
      .post(REGISTER)
      .set('Content-Type', 'application/json')
      .send('{not json');
    expectError(response, 400, 'INVALID_JSON');
  });

  it('answers 413 for an oversized body', async () => {
    const response = await request(ctx.app)
      .post(REGISTER)
      .send(newUser({ displayName: 'x'.repeat(20_000) }));
    expectError(response, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('answers 409 for a taken email, also in another case', async () => {
    const body = newUser();
    await request(ctx.app).post(REGISTER).send(body).expect(201);

    const response = await request(ctx.app)
      .post(REGISTER)
      .send({ ...body, email: body.email.toUpperCase() });
    expectError(response, 409, 'EMAIL_TAKEN');
  });

  it('lets only one of two parallel registrations with one email succeed', async () => {
    const body = newUser();
    const responses = await Promise.all([
      request(ctx.app).post(REGISTER).send(body),
      request(ctx.app).post(REGISTER).send(body),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('treats SQL in a field as plain text', async () => {
    const displayName = "Robert'); DROP TABLE users;--";
    const response = await request(ctx.app).post(REGISTER).send(newUser({ displayName }));

    expect(response.status).toBe(201);
    expect(response.body.displayName).toBe(displayName);
    await ctx.pool.query('SELECT 1 FROM users LIMIT 1');
  });
});

describe('POST /auth/login', () => {
  it('returns tokens with the right claims', async () => {
    const body = newUser();
    const registered = await request(ctx.app).post(REGISTER).send(body).expect(201);

    const response = await request(ctx.app)
      .post(LOGIN)
      .send({ email: body.email, password: body.password });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(response.body.user.id).toBe(registered.body.id);

    const claims = jwt.verify(response.body.accessToken, ctx.publicKey, {
      algorithms: ['RS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe(registered.body.id);
    expect(claims.roles).toEqual(['BIDDER']);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);
  });

  it('logs in the seeded demo seller with the password from the seed file', async () => {
    const response = await request(ctx.app)
      .post(LOGIN)
      .send({ email: 'seller@auction.test', password: 'Seller#Demo2026' });

    expect(response.status).toBe(200);
    expect(response.body.user.roles).toEqual(['BIDDER', 'SELLER']);
  });

  it('stores only the hash of the refresh token', async () => {
    const { tokens } = await registerAndLogin();

    const raw = await ctx.pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [
      tokens.refreshToken,
    ]);
    const hashed = await ctx.pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [
      sha256(tokens.refreshToken),
    ]);
    expect(raw.rowCount).toBe(0);
    expect(hashed.rowCount).toBe(1);
  });

  it('gives the same answer for a wrong password, an unknown email and a banned user', async () => {
    const existing = newUser();
    await request(ctx.app).post(REGISTER).send(existing).expect(201);
    const banned = newUser();
    await request(ctx.app).post(REGISTER).send(banned).expect(201);
    await ctx.pool.query(`UPDATE users SET status = 'BANNED' WHERE email = $1`, [banned.email]);

    const responses = await Promise.all([
      request(ctx.app).post(LOGIN).send({ email: existing.email, password: 'wrong password' }),
      request(ctx.app).post(LOGIN).send({ email: 'nobody@test.io', password: 'wrong password' }),
      request(ctx.app).post(LOGIN).send({ email: banned.email, password: banned.password }),
    ]);

    for (const response of responses) {
      expectError(response, 401, 'INVALID_CREDENTIALS');
      expect(response.body.error.message).toBe('Invalid credentials');
    }
  });

  it.each([
    ['no email', { password: 'x' }],
    ['no password', { email: 'a@test.io' }],
    ['an extra field', { email: 'a@test.io', password: 'x', admin: true }],
    ['an object as password', { email: 'a@test.io', password: { $ne: null } }],
  ])('answers 400 for %s', async (_case, body) => {
    const response = await request(ctx.app).post(LOGIN).send(body);
    expectError(response, 400, 'VALIDATION_ERROR');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates: returns a new pair that works', async () => {
    const { tokens } = await registerAndLogin();

    const response = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).not.toBe(tokens.refreshToken);
    await request(ctx.app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: response.body.refreshToken })
      .expect(200);
  });

  it('revokes the whole family when a used token comes back', async () => {
    const { tokens } = await registerAndLogin();
    const rotated = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    const reuse = await request(ctx.app).post(REFRESH).send({ refreshToken: tokens.refreshToken });
    expectError(reuse, 401, 'INVALID_REFRESH_TOKEN');

    const newest = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: rotated.body.refreshToken });
    expectError(newest, 401, 'INVALID_REFRESH_TOKEN');
  });

  it('lets at most one of many parallel refreshes with one token succeed', async () => {
    const { tokens } = await registerAndLogin();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(ctx.app).post(REFRESH).send({ refreshToken: tokens.refreshToken }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(4);
  });

  it('waits for the row lock, so a refresh in progress cannot be overtaken', async () => {
    const { tokens } = await registerAndLogin();
    const other = await ctx.pool.connect();
    try {
      // Another refresh has used this token but has not committed yet.
      await other.query('BEGIN');
      await other.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
        sha256(tokens.refreshToken),
      ]);

      const pending = request(ctx.app)
        .post(REFRESH)
        .send({ refreshToken: tokens.refreshToken })
        .then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query('COMMIT');

      // With FOR UPDATE it sees the committed use. Without it, it reads stale data and gets a 200.
      expectError(await pending, 401, 'INVALID_REFRESH_TOKEN');
    } finally {
      other.release();
    }
  });

  it('refuses an expired token', async () => {
    const { tokens } = await registerAndLogin();
    await ctx.pool.query(
      `UPDATE refresh_tokens
       SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       WHERE token_hash = $1`,
      [sha256(tokens.refreshToken)],
    );

    const response = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken });
    expectError(response, 401, 'INVALID_REFRESH_TOKEN');
  });

  it('refuses a banned user and revokes the family', async () => {
    const { user, tokens } = await registerAndLogin();
    await ctx.pool.query(`UPDATE users SET status = 'BANNED' WHERE email = $1`, [user.email]);

    const response = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken });
    expectError(response, 401, 'INVALID_REFRESH_TOKEN');

    const { rows } = await ctx.pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [sha256(tokens.refreshToken)],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it('puts the current roles in the new access token', async () => {
    const { user, tokens } = await registerAndLogin();
    await ctx.pool.query(
      `INSERT INTO user_roles (user_id, role)
       SELECT id, 'SELLER' FROM users WHERE email = $1`,
      [user.email],
    );

    const response = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    const claims = jwt.decode(response.body.accessToken) as jwt.JwtPayload;
    expect(claims.roles).toEqual(['BIDDER', 'SELLER']);
  });

  it('answers 401 for an unknown token and 400 for no token', async () => {
    expectError(
      await request(ctx.app).post(REFRESH).send({ refreshToken: 'unknown' }),
      401,
      'INVALID_REFRESH_TOKEN',
    );
    expectError(await request(ctx.app).post(REFRESH).send({}), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /auth/logout', () => {
  it('answers 204 and the token stops working', async () => {
    const { tokens } = await registerAndLogin();

    await request(ctx.app).post(LOGOUT).send({ refreshToken: tokens.refreshToken }).expect(204);

    expectError(
      await request(ctx.app).post(REFRESH).send({ refreshToken: tokens.refreshToken }),
      401,
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('revokes later tokens of the same session', async () => {
    const { tokens } = await registerAndLogin();
    const rotated = await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    await request(ctx.app)
      .post(LOGOUT)
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(204);

    expectError(
      await request(ctx.app).post(REFRESH).send({ refreshToken: rotated.body.refreshToken }),
      401,
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('does not end the sessions on other devices', async () => {
    const { user, tokens } = await registerAndLogin();
    const other = await request(ctx.app)
      .post(LOGIN)
      .send({ email: user.email, password: user.password })
      .expect(200);

    await request(ctx.app).post(LOGOUT).send({ refreshToken: tokens.refreshToken }).expect(204);

    await request(ctx.app)
      .post(REFRESH)
      .send({ refreshToken: other.body.refreshToken })
      .expect(200);
  });

  it('answers 204 for an unknown token, revealing nothing', async () => {
    await request(ctx.app).post(LOGOUT).send({ refreshToken: 'unknown' }).expect(204);
  });

  it('answers 400 for no token', async () => {
    expectError(await request(ctx.app).post(LOGOUT).send({}), 400, 'VALIDATION_ERROR');
  });
});

describe('/users/me', () => {
  const ME = '/api/v1/users/me';

  it('GET returns the caller', async () => {
    const { user, tokens } = await registerAndLogin();

    const response = await request(ctx.app)
      .get(ME)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(user.email);
    expect(JSON.stringify(response.body)).not.toMatch(/argon2/);
  });

  it('GET answers 401 without a token, with a bad token, and with a refresh token', async () => {
    const { tokens } = await registerAndLogin();

    expectError(await request(ctx.app).get(ME), 401, 'UNAUTHORIZED');
    expectError(
      await request(ctx.app).get(ME).set('Authorization', 'Bearer a.b.c'),
      401,
      'UNAUTHORIZED',
    );
    expectError(
      await request(ctx.app).get(ME).set('Authorization', `Bearer ${tokens.refreshToken}`),
      401,
      'UNAUTHORIZED',
    );
  });

  it('GET answers 404 if the user no longer exists', async () => {
    const { user, tokens } = await registerAndLogin();
    await ctx.pool.query('DELETE FROM users WHERE email = $1', [user.email]);

    expectError(
      await request(ctx.app).get(ME).set('Authorization', `Bearer ${tokens.accessToken}`),
      404,
      'NOT_FOUND',
    );
  });

  it('PATCH changes the display name', async () => {
    const { tokens } = await registerAndLogin();

    const response = await request(ctx.app)
      .patch(ME)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ displayName: '  New Name  ' });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('New Name');
  });

  it.each([
    ['email', { displayName: 'x', email: 'other@test.io' }],
    ['roles', { displayName: 'x', roles: ['ADMIN'] }],
    ['status', { status: 'ACTIVE' }],
    ['password', { password: 'new password value' }],
    ['a blank display name', { displayName: ' ' }],
    ['an empty body', {}],
  ])('PATCH answers 400 for %s (Q2)', async (_case, body) => {
    const { tokens } = await registerAndLogin();

    const response = await request(ctx.app)
      .patch(ME)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send(body);

    expectError(response, 400, 'VALIDATION_ERROR');
  });

  it('PATCH answers 401 without a token', async () => {
    expectError(await request(ctx.app).patch(ME).send({ displayName: 'x' }), 401, 'UNAUTHORIZED');
  });
});

describe('other routes', () => {
  it('GET /health answers 200 when the database is reachable', async () => {
    const response = await request(ctx.app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('answers the standard 404 for an unknown route', async () => {
    expectError(await request(ctx.app).get('/api/v1/nope'), 404, 'NOT_FOUND');
  });
});
