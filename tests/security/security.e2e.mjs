// Security test suite (task A-23), run through the gateway against the started stack:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:security
// Covers: missing, expired, forged and tampered JWTs; the RBAC matrix; SQL injection payloads;
// CORS; security headers. Uses the seeded demo accounts and the local JWT keys in secrets/.
// No packages needed: tokens are built with node:crypto, so CI can run it without npm install.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { before, describe, test } from 'node:test';

const HTTPS = process.env.GATEWAY_URL ?? 'https://localhost:8443';
const API = `${HTTPS}/api/v1`;
const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';
const PRIVATE_KEY = readFileSync('secrets/jwt_private.pem', 'utf8');
const PUBLIC_KEY = readFileSync('secrets/jwt_public.pem', 'utf8');
const FRONTEND = 'http://localhost:5173';
const SEEDED_LIVE_ID = '10000000-0000-4000-8000-000000000001';
const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';

/**
 * Calls the API. A 429 from the gateway is waited out, so rate limits never make a test flaky.
 * elapsedMs is the time of the last attempt only, so a wait for the rate limit never counts as slow.
 */
async function call(path, { method = 'GET', token, body, headers = {} } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const started = Date.now();
    const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 12) {
      await sleep(Number(response.headers.get('retry-after') ?? 5) * 1000);
      continue;
    }
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: response.status,
      headers: response.headers,
      body: json,
      elapsedMs: Date.now() - started,
    };
  }
}

async function login(email, password) {
  const response = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(response.body)}`);
  return response.body;
}

const base64url = (value) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function jwt(payload, { alg = 'RS256', key = PRIVATE_KEY } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 900, ...payload };
  const unsigned = `${base64url({ alg, typ: 'JWT' })}.${base64url(claims)}`;
  if (alg === 'none') return `${unsigned}.`;
  if (alg === 'HS256') {
    return `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`;
  }
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(key, 'base64url')}`;
}

function assertGenericUnauthorized(response, label) {
  assert.equal(response.status, 401, label);
  assert.equal(response.body.error.code, 'UNAUTHORIZED', label);
  assert.equal(response.body.error.message, 'Authentication required', label);
}

let tokens;

before(async () => {
  tokens = {
    bidder: (await login('bidder1@auction.test', 'Bidder#Demo2026')).accessToken,
    seller: (await login('seller@auction.test', 'Seller#Demo2026')).accessToken,
    admin: (await login('admin@auction.test', 'Admin#Demo2026')).accessToken,
  };
});

describe('JWT: every bad token gets the same 401', () => {
  const sellerId = '00000000-0000-4000-8000-000000000002';
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  });
  const now = Math.floor(Date.now() / 1000);

  const badTokens = {
    'no token': undefined,
    'not a JWT': 'not-a-token',
    'expired an hour ago': jwt({
      sub: sellerId,
      roles: ['SELLER'],
      iat: now - 7200,
      exp: now - 3600,
    }),
    'signed with another key (forged)': jwt({ sub: sellerId, roles: ['ADMIN'] }, { key: attacker }),
    'alg "none" (unsigned)': jwt({ sub: sellerId, roles: ['ADMIN'] }, { alg: 'none' }),
    'HS256 signed with the public key': jwt(
      { sub: sellerId, roles: ['ADMIN'] },
      { alg: 'HS256', key: PUBLIC_KEY },
    ),
    'another issuer': jwt({ sub: sellerId, roles: ['SELLER'], iss: 'evil-issuer' }),
    'another audience': jwt({ sub: sellerId, roles: ['SELLER'], aud: 'other-app' }),
    'a role that does not exist': jwt({ sub: sellerId, roles: ['SUPERUSER'] }),
    'no roles': jwt({ sub: sellerId, roles: [] }),
  };

  for (const [label, token] of Object.entries(badTokens)) {
    test(label, async () => {
      for (const [method, path, body] of [
        ['GET', '/users/me'],
        ['GET', '/users'],
        ['POST', '/auctions', {}],
      ]) {
        assertGenericUnauthorized(await call(path, { method, token, body }), `${label}: ${path}`);
      }
    });
  }

  test('a real token whose payload was edited to ADMIN (signature no longer matches)', async () => {
    const [header, payload, signature] = tokens.bidder.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const tampered = `${header}.${base64url({ ...claims, roles: ['ADMIN'] })}.${signature}`;
    assertGenericUnauthorized(await call('/users', { token: tampered }), 'tampered');
  });

  test('a token signed with the real key is accepted (the suite is not just refusing everything)', async () => {
    const response = await call('/users/me', { token: jwt({ sub: sellerId, roles: ['SELLER'] }) });
    assert.equal(response.status, 200);
  });
});

describe('RBAC matrix: role checks in routes, ownership in services', () => {
  const unknownId = randomUUID();
  const newAuction = () => ({
    categoryId: '20000000-0000-4000-8000-000000000001',
    title: `RBAC ${randomUUID().slice(0, 8)}`,
    startingPriceCents: 1000,
    minIncrementCents: 100,
    startsAt: '2030-01-01T10:00:00Z',
    endsAt: '2030-01-02T10:00:00Z',
  });
  // [method, path, body, expected for visitor, bidder, seller, admin]
  const matrix = [
    ['GET', '/auctions', undefined, [200, 200, 200, 200]],
    ['GET', `/auctions/${SEEDED_LIVE_ID}`, undefined, [200, 200, 200, 200]],
    ['POST', '/auctions', newAuction, [401, 403, 201, 403]],
    ['PATCH', `/auctions/${SEEDED_LIVE_ID}`, { title: 'Not yours' }, [401, 403, 409, 403]],
    ['POST', `/auctions/${unknownId}/publish`, undefined, [401, 403, 404, 403]],
    ['POST', `/auctions/${unknownId}/cancel`, undefined, [401, 403, 404, 404]],
    ['DELETE', `/auctions/${unknownId}`, undefined, [401, 403, 404, 403]],
    ['GET', '/users/me', undefined, [401, 200, 200, 200]],
    ['GET', '/users', undefined, [401, 403, 403, 200]],
    ['PATCH', `/users/${BIDDER2_ID}/roles`, { roles: ['BIDDER'] }, [401, 403, 403, 200]],
    ['PATCH', `/users/${unknownId}/status`, { status: 'BANNED' }, [401, 403, 403, 404]],
    ['GET', '/auctions/mine', undefined, [401, 403, 200, 403]],
    // bidding-service. An amount of 0 is invalid, so no bid is ever placed by this suite.
    ['POST', `/auctions/${SEEDED_LIVE_ID}/bids`, { amountCents: 0 }, [401, 400, 400, 403]],
    // Settlements are for admins only.
    ['GET', '/payments', undefined, [401, 403, 403, 200]],
    ['GET', '/categories', undefined, [200, 200, 200, 200]],
    // A 1-character name is invalid, so the admin's allowed request creates nothing (400, not 201).
    ['POST', '/categories', { name: 'x' }, [401, 403, 403, 400]],
    // Wallets belong to bidders and sellers (decision Q13); an admin-only account has none.
    ['GET', '/wallet/me', undefined, [401, 200, 200, 403]],
    ['GET', '/wallet/transactions', undefined, [401, 200, 200, 403]],
    ['POST', '/wallet/deposit', { amountCents: 0 }, [401, 400, 400, 403]],
  ];
  const roles = ['visitor', 'bidder', 'seller', 'admin'];

  for (const [method, path, body, expected] of matrix) {
    test(`${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`, async () => {
      const actual = [];
      for (const role of roles) {
        const response = await call(path, {
          method,
          token: role === 'visitor' ? undefined : tokens[role],
          body: typeof body === 'function' ? body() : body,
        });
        actual.push(response.status);
        // An allowed create made a real draft: delete it, so running the suite leaves no data.
        if (method === 'POST' && path === '/auctions' && response.status === 201) {
          await call(`/auctions/${response.body.id}`, { method: 'DELETE', token: tokens[role] });
        }
      }
      assert.deepEqual(actual, expected, `visitor, bidder, seller, admin`);
    });
  }

  test('a seller cannot change another seller auction (ownership in the service layer)', async () => {
    const other = await call('/auctions', {
      method: 'POST',
      token: tokens.seller,
      body: newAuction(),
    });
    assert.equal(other.status, 201);
    // The demo seller owns it. A token for another SELLER (signed with the real key) may not edit it.
    const strangerSeller = jwt({ sub: randomUUID(), roles: ['SELLER'] });
    const response = await call(`/auctions/${other.body.id}`, {
      method: 'PATCH',
      token: strangerSeller,
      body: { title: 'Taken over' },
    });
    // A draft is invisible to other sellers, so 404 and not 403 (decision Q4).
    assert.equal(response.status, 404);
    // The owner can still delete it, which also leaves no test data behind.
    const removed = await call(`/auctions/${other.body.id}`, {
      method: 'DELETE',
      token: tokens.seller,
    });
    assert.equal(removed.status, 204);
  });
});

describe('SQL injection: payloads are data, never SQL', () => {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    '" OR ""="',
    '1; SELECT pg_sleep(3); --',
    "' UNION SELECT password_hash FROM users --",
    '\\',
    "admin@auction.test' --",
  ];
  let totalBefore;

  before(async () => {
    totalBefore = (await call('/auctions?size=1')).body.total;
  });

  for (const payload of payloads) {
    test(`payload ${JSON.stringify(payload)}`, async () => {
      const search = await call(`/auctions?q=${encodeURIComponent(payload)}`);
      // Only the answer time counts: a wait for the rate limit is not slowness.
      assert.ok(search.elapsedMs < 2000, `pg_sleep never ran (${search.elapsedMs} ms)`);
      assert.equal(search.status, 200, 'search treats it as words');

      for (const query of [
        `sort=${encodeURIComponent(payload)}`,
        `categoryId=${encodeURIComponent(payload)}`,
        `status=${encodeURIComponent(payload)}`,
        `page=${encodeURIComponent(payload)}`,
      ]) {
        assert.equal((await call(`/auctions?${query}`)).status, 400, query);
      }
      assert.equal((await call(`/auctions/${encodeURIComponent(payload)}`)).status, 400, 'id');
      const users = await call(`/users?status=${encodeURIComponent(payload)}`, {
        token: tokens.admin,
      });
      assert.equal(users.status, 400, 'admin user filter');
      const loginAttempt = await call('/auth/login', {
        method: 'POST',
        body: { email: payload, password: payload },
      });
      assert.ok([400, 401].includes(loginAttempt.status), `login answered ${loginAttempt.status}`);
    });
  }

  test('nothing was dropped or changed', async () => {
    assert.equal((await call('/auctions?size=1')).body.total, totalBefore);
    assert.equal((await call('/users/me', { token: tokens.admin })).status, 200);
  });
});

describe('CORS', () => {
  test('the frontend origin may read answers, including errors', async () => {
    for (const path of [
      '/auctions',
      '/users/me',
      '/wallet/me',
      `/auctions/${SEEDED_LIVE_ID}/bids`,
    ]) {
      const response = await call(path, { headers: { Origin: FRONTEND } });
      assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND, path);
      assert.match(response.headers.get('vary') ?? '', /Origin/);
    }
  });

  test('a preflight is answered by the gateway with the allowed methods and headers', async () => {
    const response = await call('/auctions', {
      method: 'OPTIONS',
      headers: {
        Origin: FRONTEND,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
  });

  test('another origin gets no permission, and credentials are never allowed', async () => {
    for (const origin of ['https://evil.test', 'http://localhost:5173.evil.test', 'null']) {
      const response = await call('/auctions', { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), null, origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
    }
  });
});

describe('security headers (helmet in each service)', () => {
  test('are on answers from every service, through the gateway', async () => {
    for (const path of ['/auctions', '/users/me']) {
      const { headers } = await call(path);
      assert.equal(headers.get('x-content-type-options'), 'nosniff', path);
      assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN', path);
      assert.ok(headers.get('content-security-policy'), path);
      assert.equal(headers.get('x-powered-by'), null, path);
      // No HSTS on localhost (gateway/README.md, TLS limits).
      assert.equal(headers.get('strict-transport-security'), null, path);
    }
  });

  test('a 500-class error never leaks a stack trace', async (t) => {
    // Every service exists now, so no path gives a 500-class answer by itself. The test makes one:
    // it stops notification-service, checks what the gateway answers for its path, and starts it
    // again. It needs the Docker CLI and runs from the repository root, as in CI.
    const docker = process.env.DOCKER_BIN ?? 'docker';
    const compose = (...args) => execFileSync(docker, ['compose', ...args], { stdio: 'pipe' });
    try {
      compose('stop', 'notification-service');
    } catch {
      t.skip('the Docker CLI is not available, so the service cannot be stopped');
      return;
    }
    try {
      const response = await call('/notifications');
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(response.body), /at .*\(|node_modules|stack/i);
    } finally {
      compose('start', 'notification-service');
      // Wait until the service answers again, so the next tests find it up.
      for (let i = 0; i < 60 && (await call('/notifications')).status === 503; i += 1) {
        await sleep(500);
      }
    }
  });
});
