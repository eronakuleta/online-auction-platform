import request from 'supertest';
import { LOGIN_THROTTLE, createTestContext, newUser, type TestContext } from './helpers';

let ctx: TestContext;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const MAX = LOGIN_THROTTLE.maxFailures;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

async function registered() {
  const user = newUser();
  await request(ctx.app).post(REGISTER).send(user).expect(201);
  return user;
}

function login(email: string, password: string) {
  return request(ctx.app).post(LOGIN).send({ email, password });
}

async function failTimes(email: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await login(email, 'wrong password').expect(401);
  }
}

async function lockState(email: string) {
  const { rows } = await ctx.pool.query<{ failed_login_count: number; locked_until: Date | null }>(
    'SELECT failed_login_count, locked_until FROM users WHERE email = $1',
    [email],
  );
  return rows[0];
}

function expectInvalidCredentials(response: request.Response): void {
  expect(response.status).toBe(401);
  expect(response.body.error).toMatchObject({
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid credentials',
  });
}

describe('per-account login throttling', () => {
  it(`locks the account after ${MAX} failures: even the right password then gets the same 401`, async () => {
    const user = await registered();
    await failTimes(user.email, MAX);

    expectInvalidCredentials(await login(user.email, user.password));
  });

  it('allows one attempt fewer than the limit', async () => {
    const user = await registered();
    await failTimes(user.email, MAX - 1);

    await login(user.email, user.password).expect(200);
  });

  it('lets the user in again once the lock has expired, and starts counting from zero', async () => {
    const user = await registered();
    await failTimes(user.email, MAX);
    await ctx.pool.query(
      `UPDATE users SET locked_until = now() - interval '1 second' WHERE email = $1`,
      [user.email],
    );

    await login(user.email, user.password).expect(200);

    expect(await lockState(user.email)).toMatchObject({ failed_login_count: 0 });
  });

  it('resets the count on a successful login', async () => {
    const user = await registered();
    await failTimes(user.email, MAX - 1);
    await login(user.email, user.password).expect(200);
    await failTimes(user.email, MAX - 1);

    await login(user.email, user.password).expect(200);
  });

  it('does not extend the lock with more wrong guesses during it', async () => {
    const user = await registered();
    await failTimes(user.email, MAX);
    const before = await lockState(user.email);

    await failTimes(user.email, 3);

    const after = await lockState(user.email);
    expect(after?.locked_until).toEqual(before?.locked_until);
    expect(after?.failed_login_count).toBe(0);
  });

  it('counts parallel failures correctly and locks the account', async () => {
    const user = await registered();

    const responses = await Promise.all(
      Array.from({ length: MAX }, () => login(user.email, 'wrong password')),
    );

    expect(responses.every((r) => r.status === 401)).toBe(true);
    expect((await lockState(user.email))?.locked_until).not.toBeNull();
    expectInvalidCredentials(await login(user.email, user.password));
  });

  it('locks only the attacked account, not others', async () => {
    const attacked = await registered();
    const other = await registered();
    await failTimes(attacked.email, MAX);

    await login(other.email, other.password).expect(200);
  });

  it('gives an unknown email the same answer, and stores nothing for it', async () => {
    const before = await ctx.pool.query('SELECT count(*) FROM users');

    for (let i = 0; i < MAX + 1; i += 1) {
      expectInvalidCredentials(await login('nobody-here@test.io', 'wrong password'));
    }

    const after = await ctx.pool.query('SELECT count(*) FROM users');
    expect(after.rows).toEqual(before.rows);
  });

  it('keeps refresh working for a session started before the lock', async () => {
    const user = await registered();
    const session = await login(user.email, user.password).expect(200);
    await failTimes(user.email, MAX);

    await request(ctx.app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.body.refreshToken })
      .expect(200);
  });
});
