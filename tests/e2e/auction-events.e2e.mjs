// End-to-end test of auction-service's events (task A-13), on the running Docker Compose stack with
// the real RabbitMQ:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:events
// It plays the other services: it listens like bidding-service for auction.published, and sends
// auction.closed and payment.completed like bidding-service and payment-service will. It uses its
// own temporary queue and sends only to auction-service's queue, so other services' queues and the
// seeded demo auctions are never touched.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
// amqplib is a dependency of @auction/shared-common, installed at the root by npm workspaces.
import { connect } from 'amqplib';

const API = `${process.env.GATEWAY_URL ?? 'https://localhost:8443'}/api/v1`;
const RABBITMQ_URL =
  process.env.RABBITMQ_TEST_URL ?? 'amqp://auction:change-me-rabbit@localhost:5672';
const EXCHANGE = 'auction.events';
const AUCTION_QUEUE = 'auction-service.events';

let connection;
let channel;
let listenQueue;
const received = [];
let sellerToken;
let sellerId;

async function call(path, { token, requestId, ...options } = {}) {
  // Waits out the gateway's rate limit, like the security suite: earlier suites may have used up
  // this IP's login allowance.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
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

async function createPublishedAuction(requestId) {
  const hour = 3_600_000;
  const created = await call('/auctions', {
    method: 'POST',
    token: sellerToken,
    body: JSON.stringify({
      categoryId: '20000000-0000-4000-8000-000000000001',
      title: `Events e2e ${randomUUID().slice(0, 8)}`,
      startingPriceCents: 1500,
      minIncrementCents: 100,
      reservePriceCents: null,
      startsAt: new Date(Date.now() + hour).toISOString(),
      endsAt: new Date(Date.now() + 24 * hour).toISOString(),
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const published = await call(`/auctions/${created.body.id}/publish`, {
    method: 'POST',
    token: sellerToken,
    requestId,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return published.body;
}

/** Sends an event the way another service would, but only to auction-service's queue. */
function sendToAuctionService(type, payload) {
  const event = {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload,
  };
  channel.sendToQueue(AUCTION_QUEUE, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
    messageId: event.eventId,
    type,
  });
  return event;
}

async function statusOf(id) {
  const response = await call(`/auctions/${id}`, { token: sellerToken });
  return response.body.status;
}

before(async () => {
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'seller@auction.test', password: 'Seller#Demo2026' }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  sellerToken = login.body.accessToken;
  sellerId = (await call('/users/me', { token: sellerToken })).body.id;

  connection = await connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  // A private queue that the broker deletes when this test disconnects.
  ({ queue: listenQueue } = await channel.assertQueue('', { exclusive: true, autoDelete: true }));
  await channel.bindQueue(listenQueue, EXCHANGE, 'auction.published');
  await channel.consume(
    listenQueue,
    (message) => {
      received.push({
        routingKey: message.fields.routingKey,
        headers: message.properties.headers,
        persistent: message.properties.deliveryMode === 2,
        body: JSON.parse(message.content.toString()),
      });
    },
    { noAck: true },
  );
});

after(async () => {
  await connection?.close();
});

test('publishing an auction sends auction.published through the real broker', async () => {
  const requestId = `e2e-events-${randomUUID().slice(0, 8)}`;
  const auction = await createPublishedAuction(requestId);

  const message = await until('auction.published', () =>
    received.find((m) => m.body.payload?.auctionId === auction.id),
  );

  assert.equal(message.routingKey, 'auction.published');
  assert.ok(message.persistent, 'the message is persistent');
  assert.equal(message.body.type, 'auction.published');
  assert.equal(message.body.version, 1);
  assert.match(message.body.eventId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(message.body.payload, {
    auctionId: auction.id,
    sellerId,
    title: auction.title,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    startingPriceCents: 1500,
    minIncrementCents: 100,
    reservePriceCents: null,
    currency: 'EUR',
  });
  // The same ID as the HTTP request, so one log search follows it into the next service.
  assert.equal(message.headers['x-correlation-id'], requestId);
});

test('auction-service consumes auction.closed and payment.completed from its queue', async () => {
  const auction = await createPublishedAuction();
  const winnerId = randomUUID();
  const common = { auctionId: auction.id, sellerId, title: auction.title };

  sendToAuctionService('auction.closed', {
    ...common,
    currency: 'EUR',
    closedAt: new Date().toISOString(),
    losingBidderIds: [],
    result: 'SOLD',
    winnerId,
    amountCents: 2500,
  });
  await until('CLOSED_SOLD', async () => (await statusOf(auction.id)) === 'CLOSED_SOLD');
  const closed = await call(`/auctions/${auction.id}`, { token: sellerToken });
  assert.equal(closed.body.winnerId, winnerId);
  assert.equal(closed.body.finalPriceCents, 2500);

  sendToAuctionService('payment.completed', {
    ...common,
    settlementId: randomUUID(),
    winnerId,
    amountCents: 2500,
    feeCents: 125,
    sellerCents: 2375,
    currency: 'EUR',
    settledAt: new Date().toISOString(),
  });
  await until('SETTLED', async () => (await statusOf(auction.id)) === 'SETTLED');
});

test('a payment that overtakes auction.closed is retried and applied once the close arrives', async () => {
  const auction = await createPublishedAuction();
  const winnerId = randomUUID();
  const common = { auctionId: auction.id, sellerId, title: auction.title };

  sendToAuctionService('payment.completed', {
    ...common,
    settlementId: randomUUID(),
    winnerId,
    amountCents: 2500,
    feeCents: 125,
    sellerCents: 2375,
    currency: 'EUR',
    settledAt: new Date().toISOString(),
  });
  await sleep(1000);
  assert.equal(await statusOf(auction.id), 'PUBLISHED', 'the early payment changed nothing');

  sendToAuctionService('auction.closed', {
    ...common,
    currency: 'EUR',
    closedAt: new Date().toISOString(),
    losingBidderIds: [],
    result: 'SOLD',
    winnerId,
    amountCents: 2500,
  });
  // The retry queue holds the payment for 5 s, so allow for a couple of rounds.
  await until(
    'SETTLED after the retry',
    async () => (await statusOf(auction.id)) === 'SETTLED',
    20_000,
  );
});
