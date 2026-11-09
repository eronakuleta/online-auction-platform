// Smoke test of the API gateway against the running Docker Compose stack (task A-20).
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:gateway
// NODE_EXTRA_CA_CERTS makes Node trust our self-signed certificate, so TLS is really verified
// (hostname included) instead of being switched off. Uses the seeded demo accounts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const HTTPS = process.env.GATEWAY_URL ?? 'https://localhost:8443';
const HTTP = process.env.GATEWAY_HTTP_URL ?? 'http://localhost:8080';
const API = `${HTTPS}/api/v1`;
const SEEDED_LIVE_ID = '10000000-0000-4000-8000-000000000001';

async function call(path, options = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    redirect: 'manual',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body };
}

function assertGatewayError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.deepEqual(response.body.error.details, []);
  assert.equal(response.body.error.requestId, response.headers.get('x-request-id'));
}

async function login(email, password) {
  const response = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.accessToken;
}

test('TLS: the certificate is valid for localhost and the gateway answers', async () => {
  const response = await call(`${HTTPS}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(response.headers.get('server'), 'nginx', 'no version in the Server header');
});

test('HTTP redirects to HTTPS with the path kept', async () => {
  const response = await call(`${HTTP}/api/v1/auctions?page=2`);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), `${HTTPS}/api/v1/auctions?page=2`);
});

test('routes auth: login, then a protected endpoint with the token', async () => {
  const token = await login('seller@auction.test', 'Seller#Demo2026');
  const me = await call('/users/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'seller@auction.test');
});

test('routes auth: the service answers its own errors, unchanged', async () => {
  const response = await call('/users/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('routes admin endpoints under /users to auth-service', async () => {
  const token = await login('admin@auction.test', 'Admin#Demo2026');
  const response = await call('/users?size=2', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.body.size, 2);
});

test('routes the catalog and auction details to auction-service', async () => {
  const list = await call('/auctions?sort=price_asc');
  assert.equal(list.status, 200);
  assert.ok(list.body.total >= 1);
  const detail = await call(`/auctions/${SEEDED_LIVE_ID}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, SEEDED_LIVE_ID);
});

test('routes bids, state and stream to bidding-service, not auction-service', async () => {
  // Only bidding-service has POST /auctions/:id/bids, so a 401 (not auction-service's 404) proves
  // the regex location sends this path to bidding-service (B-06).
  const bid = await call(`/auctions/${SEEDED_LIVE_ID}/bids`, {
    method: 'POST',
    body: JSON.stringify({ amountCents: 9000 }),
  });
  assertGatewayError(bid, 401, 'UNAUTHORIZED');
  // The same location serves the public history and state (B-08, decision Q3).
  const history = await call(`/auctions/${SEEDED_LIVE_ID}/bids`);
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.body.data));
  const state = await call(`/auctions/${SEEDED_LIVE_ID}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.body.auctionId, SEEDED_LIVE_ID);
  // /bids goes to bidding-service too, and a user's own bids need a token.
  assertGatewayError(await call('/bids/me'), 401, 'UNAUTHORIZED');
});

test('streams live state through the gateway without a token and without buffering (B-12)', async () => {
  // A stream never ends by itself, so the test reads the first event and then disconnects.
  const controller = new AbortController();
  const response = await fetch(`${API}/auctions/${SEEDED_LIVE_ID}/stream`, {
    signal: controller.signal,
  });
  try {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    // The first event arrives at once only if the gateway does not buffer the response.
    while (!text.includes('\n\n', text.indexOf('event: state'))) {
      const { done, value } = await reader.read();
      assert.equal(done, false, 'the stream ended before the first event');
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text.match(/^data: (.*)$/m)[1]);
    assert.equal(data.auctionId, SEEDED_LIVE_ID);
    assert.equal(data.status, 'OPEN');
    assert.equal(Object.hasOwn(data, 'reservePriceCents'), false);
  } finally {
    controller.abort();
  }
  // An unknown auction is an ordinary JSON 404 before any stream starts.
  assertGatewayError(
    await call('/auctions/10000000-0000-4000-8000-0000000000ff/stream'),
    404,
    'AUCTION_NOT_FOUND',
  );
});

test('routes the wallet to payment-service', async () => {
  const token = await login('bidder1@auction.test', 'Bidder#Demo2026');
  const wallet = await call('/wallet/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(wallet.status, 200);
  assert.equal(wallet.body.currency, 'EUR');
  // payment-service's own answer, unchanged by the gateway.
  const anonymous = await call('/wallet/transactions');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'UNAUTHORIZED');
});

test('routes notification paths to notification-service (B-14, B-15)', async () => {
  // Its own answers in the standard error format; a 503 would mean the gateway cannot reach it.
  assertGatewayError(await call('/notifications'), 401, 'UNAUTHORIZED');
  assertGatewayError(await call('/notifications/unread-count'), 401, 'UNAUTHORIZED');
  const token = await login('bidder1@auction.test', 'Bidder#Demo2026');
  const headers = { Authorization: `Bearer ${token}` };
  const list = await call('/notifications', { headers });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data));
  const count = await call('/notifications/unread-count', { headers });
  assert.equal(count.status, 200);
  assert.equal(typeof count.body.unreadCount, 'number');
});

test('blocks /internal in every spelling, with the same 404 as an unknown route', async () => {
  const id = SEEDED_LIVE_ID;
  const paths = [
    `/internal/auctions/${id}/cancel`,
    `/api/v1/internal/auctions/${id}/cancel`,
    `/api/v1/auctions/../../../internal/funds-check`,
    `/%69nternal/funds-check`,
    `/INTERNAL/funds-check`,
    `//internal/funds-check`,
    // Inside a routed prefix: without the explicit block this would reach payment-service.
    `/api/v1/payments/internal/funds-check`,
    `/api/v1/auctions/${id}/internal`,
  ];
  for (const path of paths) {
    const response = await call(`${HTTPS}${path}`, { method: 'POST', body: '{}' });
    assertGatewayError(response, 404, 'NOT_FOUND');
    // The gateway's own message, so the request never reached a service.
    assert.equal(response.body.error.message, 'Route not found', path);
  }
});

test('does not expose services own health checks or unknown routes', async () => {
  for (const path of ['/api/v1/health', '/health/../api', '/api/v2/auctions', '/admin']) {
    const response = await call(`${HTTPS}${path}`);
    assert.equal(response.status, 404, path);
  }
  assertGatewayError(await call(`${HTTPS}/nope`), 404, 'NOT_FOUND');
});

test('passes a safe X-Request-Id through to the service and back', async () => {
  const response = await call('/users/me', { headers: { 'X-Request-Id': 'smoke-trace-42' } });
  assert.equal(response.headers.get('x-request-id'), 'smoke-trace-42');
  assert.equal(response.body.error.requestId, 'smoke-trace-42');
});

test('replaces an unsafe X-Request-Id with a new one', async () => {
  const response = await call('/nope', { headers: { 'X-Request-Id': 'bad id <script>' } });
  const id = response.headers.get('x-request-id');
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(response.body.error.requestId, id);
});

test('refuses a body over the limit with 413', async () => {
  const response = await call('/auctions', {
    method: 'POST',
    body: JSON.stringify({ title: 'x'.repeat(200_000) }),
  });
  assertGatewayError(response, 413, 'PAYLOAD_TOO_LARGE');
});

// Last, because it uses up this IP's login allowance for a while.
test('rate limits login attempts with 429 and Retry-After', async () => {
  // A previous run can leave this IP throttled. Wait for one request to reach auth first.
  for (let attempt = 0; ; attempt += 1) {
    const probe = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@test.io', password: 'wrong password' }),
    });
    if (probe.status === 401) break;
    assert.equal(probe.status, 429);
    assert.ok(attempt < 15, 'auth allowance did not recover');
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  const attempts = await Promise.all(
    Array.from({ length: 20 }, () =>
      call('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'nobody@test.io', password: 'wrong password' }),
      }),
    ),
  );
  const limited = attempts.filter((response) => response.status === 429);
  assert.ok(limited.length > 0, 'expected some 429 answers');
  assert.ok(
    attempts.some((response) => response.status === 401),
    'the first attempts reach auth-service',
  );
  assertGatewayError(limited[0], 429, 'RATE_LIMITED');
  assert.equal(limited[0].headers.get('retry-after'), '10');
});
