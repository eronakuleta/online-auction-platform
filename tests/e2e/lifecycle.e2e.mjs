// Full auction lifecycle through the gateway (task A-28), on the running Docker Compose stack:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:lifecycle
// Nothing is faked: a seller publishes NEW auctions that end about 45 seconds later, bidding-service
// learns them from auction.published, bids pass the real funds check, the closing worker closes
// them on its own, payment-service settles and auction-service shows the result. Two auctions run
// side by side: one sells, one ends below its reserve. A new user is the winner, so seeded demo
// balances only change by what the test itself deposits and pays.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const API = `${process.env.GATEWAY_URL ?? 'https://localhost:8443'}/api/v1`;
const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';
const CLOSE_TIMEOUT_MS = 150_000;

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  // Waits out the gateway's rate limit: earlier suites may have used up this IP's auth allowance.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
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

async function until(what, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await sleep(500);
  }
}

const balance = async (token) => (await call('/wallet/me', { token })).body.balanceCents;

let seller;
let winner;
let bidder2;
let admin;

before(async () => {
  const sellerLogin = await login('seller@auction.test', 'Seller#Demo2026');
  seller = { id: sellerLogin.user.id, token: sellerLogin.accessToken };
  bidder2 = {
    id: BIDDER2_ID,
    token: (await login('bidder2@auction.test', 'Bidder#Demo2026')).accessToken,
  };
  admin = (await login('admin@auction.test', 'Admin#Demo2026')).accessToken;

  // 1. Register: a brand-new user becomes the winner. user.registered gives them a wallet.
  const email = `lifecycle-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'Lifecycle#E2e-2026';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: { email, password, displayName: 'Lifecycle Winner' },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  winner = { id: registered.body.id, token: (await login(email, password)).accessToken };
  const deposit = await call('/wallet/deposit', {
    method: 'POST',
    token: winner.token,
    body: { amountCents: 10_000 },
  });
  assert.equal(deposit.status, 200);
});

/** 2. A seller creates and publishes an auction that is live now and ends in about 45 s. */
async function publishAuction(title, reservePriceCents) {
  const created = await call('/auctions', {
    method: 'POST',
    token: seller.token,
    body: {
      categoryId: '20000000-0000-4000-8000-000000000003',
      title,
      startingPriceCents: 1_000,
      minIncrementCents: 100,
      reservePriceCents,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 45_000).toISOString(),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const published = await call(`/auctions/${created.body.id}/publish`, {
    method: 'POST',
    token: seller.token,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  // bidding-service builds its snapshot from auction.published (B-05).
  await until(
    'bidding to know the auction',
    async () => (await call(`/auctions/${created.body.id}/state`)).status === 200,
    10_000,
  );
  return created.body.id;
}

const bid = (id, token, amountCents) =>
  call(`/auctions/${id}/bids`, {
    method: 'POST',
    token,
    body: { amountCents },
    headers: { 'Idempotency-Key': randomUUID() },
  });

const statusOf = async (id) => (await call(`/auctions/${id}`)).body.status;

test('register, publish, bid, close, settle: a sale and a reserve not met, end to end', async () => {
  const sellerBefore = await balance(seller.token);
  const bidder2Before = await balance(bidder2.token);
  const sold = await publishAuction(`Lifecycle sale ${randomUUID().slice(0, 6)}`, 2_000);
  const unsold = await publishAuction(`Lifecycle no sale ${randomUUID().slice(0, 6)}`, 5_000);

  // 3. Bids, with the rules that span services.
  assert.equal((await bid(sold, bidder2.token, 1_500)).status, 201, 'first bid');
  const outbid = await bid(sold, winner.token, 2_500);
  assert.equal(outbid.status, 201, JSON.stringify(outbid.body));
  const ownBid = await bid(sold, seller.token, 3_000);
  assert.equal(ownBid.status, 403, 'a seller cannot bid on their own auction');
  const tooMuch = await bid(unsold, winner.token, 1_000_000);
  assert.equal(tooMuch.status, 409, 'the funds check refuses a bid above the balance');
  assert.equal(tooMuch.body.error.code, 'INSUFFICIENT_FUNDS');
  assert.equal((await bid(unsold, bidder2.token, 1_500)).status, 201, 'a bid below the reserve');
  const cancel = await call(`/auctions/${sold}/cancel`, { method: 'POST', token: seller.token });
  assert.equal(cancel.status, 409, 'bidding-service refuses a seller cancel after the first bid');
  assert.equal(cancel.body.error.code, 'AUCTION_HAS_BIDS');

  const history = await call(`/auctions/${sold}/bids`);
  assert.deepEqual(
    history.body.data.map((b) => b.amountCents).sort((a, b) => a - b),
    [1_500, 2_500],
  );

  // 4. Close: the closing worker ends both on its own, about 45 s after they were created.
  await until(
    'both auctions to finish',
    async () =>
      (await statusOf(sold)) === 'SETTLED' && (await statusOf(unsold)) === 'CLOSED_NO_SALE',
    CLOSE_TIMEOUT_MS,
  );

  // 5. Settle: the winner paid, the seller got the amount minus 5%, nobody else paid anything.
  const result = (await call(`/auctions/${sold}`)).body;
  assert.equal(result.winnerId, winner.id);
  assert.equal(result.finalPriceCents, 2_500);
  assert.equal(await balance(winner.token), 10_000 - 2_500);
  assert.equal(await balance(seller.token), sellerBefore + 2_375);
  assert.equal(await balance(bidder2.token), bidder2Before, 'losing and no-sale bids cost nothing');

  const payments = (await call('/payments?size=100', { token: admin })).body.data;
  const settlement = payments.find((s) => s.auctionId === sold);
  assert.deepEqual(
    {
      status: settlement?.status,
      feeCents: settlement?.feeCents,
      sellerCents: settlement?.sellerCents,
    },
    { status: 'COMPLETED', feeCents: 125, sellerCents: 2_375 },
  );
  assert.equal(
    payments.find((s) => s.auctionId === unsold),
    undefined,
    'an auction without a sale is never settled',
  );

  // 6. Notify: notification-service built them from the events (B-14); each person reads their own
  // through the API (B-15). They arrive a moment after the result, so the check waits for them.
  const typesFor = async (person, auctionId) => {
    const { body } = await call('/notifications?size=100', { token: person.token });
    return body.data
      .filter((n) => n.auctionId === auctionId)
      .map((n) => n.type)
      .sort();
  };
  const expectNotifications = (what, person, auctionId, expected) =>
    until(
      what,
      async () => {
        const actual = await typesFor(person, auctionId);
        return JSON.stringify(actual) === JSON.stringify(expected) ? actual : undefined;
      },
      30_000,
    );
  await expectNotifications('the winner to be told', winner, sold, [
    'AUCTION_WON',
    'PAYMENT_COMPLETED',
  ]);
  await expectNotifications('the outbid bidder to be told', bidder2, sold, [
    'AUCTION_LOST',
    'OUTBID',
  ]);
  await expectNotifications('the seller to be told of the sale', seller, sold, [
    'ITEM_SOLD',
    'PAYMENT_COMPLETED',
  ]);
  await expectNotifications('the bidder below the reserve to be told', bidder2, unsold, [
    'AUCTION_LOST',
  ]);
  await expectNotifications('the seller to be told of the missed reserve', seller, unsold, [
    'NO_SALE',
  ]);
  assert.deepEqual(await typesFor(winner, unsold), [], 'a bid that was never placed is not news');

  // The bell: the winner's new notifications are unread, and read-all clears them.
  const unread = (await call('/notifications/unread-count', { token: winner.token })).body;
  assert.ok(unread.unreadCount >= 3, 'welcome, won and payment are unread');
  const readAll = await call('/notifications/read-all', { method: 'POST', token: winner.token });
  assert.equal(readAll.body.updated, unread.unreadCount);
  assert.equal(
    (await call('/notifications/unread-count', { token: winner.token })).body.unreadCount,
    0,
  );
});
