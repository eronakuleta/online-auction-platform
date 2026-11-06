// End-to-end test of payment-service's wallet (task A-17) on the running Docker Compose stack:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:wallet
// It registers a new user (so seeded demo balances never change), follows user.registered through
// the real broker into payment_db, deposits through the gateway, and calls the internal funds check
// from inside the Docker network, the way bidding-service will.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
// pg is a dependency of the services, installed at the root by npm workspaces.
import pg from 'pg';

const API = `${process.env.GATEWAY_URL ?? 'https://localhost:8443'}/api/v1`;
// The Compose Postgres from .env.example, only to see what the consumer wrote.
const PAYMENT_DB_URL =
  process.env.PAYMENT_DB_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/payment_db';

const db = new pg.Client({ connectionString: PAYMENT_DB_URL });
let user;

async function call(path, { token, ...options } = {}) {
  // Waits out the gateway's rate limit: earlier suites may have used up this IP's auth allowance.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.status === 429 && attempt < 12) {
      await sleep(Number(response.headers.get('retry-after') ?? 1) * 1000);
      continue;
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }
}

async function until(what, check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** Runs the funds check from inside auction-service's container: a real call on the Docker network. */
function fundsCheckFromInside(userId, amountCents) {
  const url = `http://payment-service:3004/internal/funds-check?userId=${userId}&amountCents=${amountCents}`;
  const script = `fetch(${JSON.stringify(url)}).then(async (r) => console.log(JSON.stringify({ status: r.status, body: await r.json() })))`;
  const output = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'auction-service', 'node', '-e', script],
    { encoding: 'utf8' },
  );
  return JSON.parse(output.trim());
}

before(async () => {
  await db.connect();
  const email = `wallet-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'Wallet#E2e-2026';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName: 'Wallet E2E' }),
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  user = { id: registered.body.id, token: login.body.accessToken };
});

after(async () => {
  await db.end();
});

test('user.registered creates the wallet through the real broker', async () => {
  // Read the database directly: GET /wallet/me would create a missing wallet itself (Q11) and so
  // could not tell whether the event did it.
  const row = await until('the wallet row', async () => {
    const { rows } = await db.query(
      'SELECT id, balance_cents, currency FROM wallets WHERE user_id = $1',
      [user.id],
    );
    return rows[0];
  });
  assert.equal(row.balance_cents, '0');
  assert.equal(row.currency, 'EUR');

  const wallet = await call('/wallet/me', { token: user.token });
  assert.equal(wallet.status, 200);
  assert.equal(wallet.body.id, row.id, 'the API shows the wallet the event created');
});

test('a deposit through the gateway shows up in the balance and the history', async () => {
  const deposit = await call('/wallet/deposit', {
    method: 'POST',
    token: user.token,
    body: JSON.stringify({ amountCents: 12_500 }),
  });
  assert.equal(deposit.status, 200, JSON.stringify(deposit.body));
  assert.equal(deposit.body.wallet.balanceCents, 12_500);

  const history = await call('/wallet/transactions', { token: user.token });
  assert.equal(history.status, 200);
  assert.equal(history.body.total, 1);
  assert.deepEqual(
    { type: history.body.data[0].type, amountCents: history.body.data[0].amountCents },
    { type: 'DEPOSIT', amountCents: 12_500 },
  );
});

test('the funds check answers other services on the Docker network', () => {
  const enough = fundsCheckFromInside(user.id, 12_500);
  assert.equal(enough.status, 200);
  assert.deepEqual(enough.body, {
    userId: user.id,
    amountCents: 12_500,
    balanceCents: 12_500,
    sufficient: true,
  });

  const tooMuch = fundsCheckFromInside(user.id, 12_501);
  assert.equal(tooMuch.body.sufficient, false);

  const unknown = fundsCheckFromInside(randomUUID(), 1);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'WALLET_NOT_FOUND');
});

test('the funds check is not reachable through the gateway', async () => {
  const response = await call(`/payments/internal/funds-check?userId=${user.id}&amountCents=1`);
  assert.equal(response.status, 404);
  assert.equal(response.body.error.message, 'Route not found', 'the gateway refused it itself');
});
