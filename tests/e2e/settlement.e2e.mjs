// End-to-end test of settlement (task A-18) across services, on the running Docker Compose stack:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:settlement
// A seller publishes a real auction; the test publishes auction.closed to the real exchange, exactly
// as bidding-service's closing worker does; payment-service settles; auction-service hears
// payment.completed and shows SETTLED. A new user is the winner, so seeded demo balances never
// change.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
// amqplib is a dependency of @auction/shared-common, installed at the root by npm workspaces.
import { connect } from 'amqplib';

const API = `${process.env.GATEWAY_URL ?? 'https://localhost:8443'}/api/v1`;
const RABBITMQ_URL =
  process.env.RABBITMQ_TEST_URL ?? 'amqp://auction:change-me-rabbit@localhost:5672';

let connection;
let channel;

async function call(path, { token, method = 'GET', body } = {}) {
  // Waits out the gateway's rate limit: earlier suites may have used up this IP's auth allowance.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 12) {
      await sleep(Number(response.headers.get('retry-after') ?? 1) * 1000);
      continue;
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }
}

async function login(email, password) {
  const response = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function until(what, check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await sleep(200);
  }
}

/** Publishes to the topic exchange, so every subscribed service gets it, as in production. */
function publishClosed(payload) {
  const event = {
    eventId: randomUUID(),
    type: 'auction.closed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload,
  };
  channel.publish('auction.events', 'auction.closed', Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
    messageId: event.eventId,
    type: 'auction.closed',
  });
}

async function publishedAuction(sellerToken) {
  const hour = 3_600_000;
  const created = await call('/auctions', {
    method: 'POST',
    token: sellerToken,
    body: {
      categoryId: '20000000-0000-4000-8000-000000000001',
      title: `Settlement e2e ${randomUUID().slice(0, 8)}`,
      startingPriceCents: 1000,
      minIncrementCents: 100,
      startsAt: new Date(Date.now() + hour).toISOString(),
      endsAt: new Date(Date.now() + 2 * hour).toISOString(),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const published = await call(`/auctions/${created.body.id}/publish`, {
    method: 'POST',
    token: sellerToken,
  });
  assert.equal(published.status, 200);
  return published.body;
}

let winner;
let seller;

before(async () => {
  connection = await connect(RABBITMQ_URL);
  channel = await connection.createChannel();

  const email = `settle-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'Settle#E2e-2026';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: { email, password, displayName: 'Settlement E2E' },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  winner = { id: registered.body.id, token: (await login(email, password)).accessToken };
  const deposit = await call('/wallet/deposit', {
    method: 'POST',
    token: winner.token,
    body: { amountCents: 10_000 },
  });
  assert.equal(deposit.status, 200);

  const sellerLogin = await login('seller@auction.test', 'Seller#Demo2026');
  seller = { id: sellerLogin.user.id, token: sellerLogin.accessToken };
});

after(async () => {
  await connection?.close();
});

test('a sale settles across services: money moves and the auction ends SETTLED', async () => {
  const auction = await publishedAuction(seller.token);
  const sellerBefore = (await call('/wallet/me', { token: seller.token })).body.balanceCents;

  publishClosed({
    auctionId: auction.id,
    sellerId: seller.id,
    title: auction.title,
    currency: 'EUR',
    closedAt: new Date().toISOString(),
    losingBidderIds: [],
    result: 'SOLD',
    winnerId: winner.id,
    amountCents: 4_000,
  });

  // auction-service: CLOSED_SOLD from auction.closed, then SETTLED from payment.completed.
  await until(
    'SETTLED',
    async () => (await call(`/auctions/${auction.id}`)).body.status === 'SETTLED',
  );

  const winnerWallet = await call('/wallet/me', { token: winner.token });
  assert.equal(winnerWallet.body.balanceCents, 6_000);
  const sellerWallet = await call('/wallet/me', { token: seller.token });
  assert.equal(sellerWallet.body.balanceCents, sellerBefore + 3_800, '4000 minus the 5% fee');

  const history = await call('/wallet/transactions', { token: winner.token });
  assert.deepEqual(
    { type: history.body.data[0].type, amountCents: history.body.data[0].amountCents },
    { type: 'SETTLEMENT_DEBIT', amountCents: -4_000 },
  );

  const admin = await login('admin@auction.test', 'Admin#Demo2026');
  const payments = await call('/payments?size=100', { token: admin.accessToken });
  assert.equal(payments.status, 200);
  const settlement = payments.body.data.find((s) => s.auctionId === auction.id);
  assert.deepEqual(
    {
      status: settlement?.status,
      amountCents: settlement?.amountCents,
      feeCents: settlement?.feeCents,
      sellerCents: settlement?.sellerCents,
    },
    { status: 'COMPLETED', amountCents: 4_000, feeCents: 200, sellerCents: 3_800 },
  );
});

test('a sale the winner cannot pay ends PAYMENT_FAILED and moves nothing', async () => {
  const auction = await publishedAuction(seller.token);
  const before = (await call('/wallet/me', { token: winner.token })).body.balanceCents;

  publishClosed({
    auctionId: auction.id,
    sellerId: seller.id,
    title: auction.title,
    currency: 'EUR',
    closedAt: new Date().toISOString(),
    losingBidderIds: [],
    result: 'SOLD',
    winnerId: winner.id,
    amountCents: before + 1,
  });

  await until(
    'PAYMENT_FAILED',
    async () => (await call(`/auctions/${auction.id}`)).body.status === 'PAYMENT_FAILED',
  );
  assert.equal((await call('/wallet/me', { token: winner.token })).body.balanceCents, before);
});
