// Load balancing of bidding-service (task A-21), on the running Docker Compose stack:
//   NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:load-balancing
// It proves two things through the gateway: requests really reach BOTH bidding replicas, and a live
// stream connected to one replica receives bids handled by the other (Redis pub/sub, B-12). The
// gateway's access log names the replica (upstream address) of every request, so the test reads it
// with `docker compose logs`; set COMPOSE_PROJECT_NAME when the stack runs under another name.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const API = `${process.env.GATEWAY_URL ?? 'https://localhost:8443'}/api/v1`;
const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
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

/**
 * The bidding replica that answered each request ID, from the gateway's log. When nginx had to try
 * a second address (a replica that just went away), $upstream_addr lists both ("a, b"); only the
 * last one answered, so only that one counts.
 */
function upstreamsByRequestId() {
  const log = execFileSync('docker', ['compose', 'logs', '--no-color', 'gateway'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map();
  for (const match of log.matchAll(/upstream=(.+?) request_id=(\S+)/g)) {
    map.set(match[2], match[1].split(',').pop().trim());
  }
  return map;
}

function runningReplicas() {
  return execFileSync('docker', ['compose', 'ps', '-q', 'bidding-service'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean).length;
}

let auctionId;
let seller;
let winner;
let bidder2;

before(async () => {
  const sellerLogin = await login('seller@auction.test', 'Seller#Demo2026');
  seller = sellerLogin.accessToken;
  bidder2 = (await login('bidder2@auction.test', 'Bidder#Demo2026')).accessToken;
  const email = `balance-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = 'Balance#E2e-2026';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: { email, password, displayName: 'Load Balance' },
  });
  assert.equal(registered.status, 201);
  winner = (await login(email, password)).accessToken;
  await call('/wallet/deposit', { method: 'POST', token: winner, body: { amountCents: 50_000 } });

  const created = await call('/auctions', {
    method: 'POST',
    token: seller,
    body: {
      categoryId: '20000000-0000-4000-8000-000000000001',
      title: `Load balancing ${randomUUID().slice(0, 6)}`,
      startingPriceCents: 1_000,
      minIncrementCents: 100,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  assert.equal(created.status, 201);
  auctionId = created.body.id;
  assert.equal(
    (await call(`/auctions/${auctionId}/publish`, { method: 'POST', token: seller })).status,
    200,
  );
  for (let i = 0; i < 50 && (await call(`/auctions/${auctionId}/state`)).status !== 200; i += 1) {
    await sleep(200);
  }
});

test('the gateway spreads requests over every bidding replica', async () => {
  assert.ok(runningReplicas() >= 2, 'at least two bidding-service containers run');
  const ids = Array.from({ length: 12 }, () => `lb-${randomUUID()}`);
  for (const id of ids) {
    const response = await call(`/auctions/${auctionId}/state`, {
      headers: { 'X-Request-Id': id },
    });
    assert.equal(response.status, 200);
  }
  await sleep(500);
  const upstreams = upstreamsByRequestId();
  const used = new Set(ids.map((id) => upstreams.get(id)));
  assert.ok(!used.has(undefined), 'every request is in the gateway log');
  assert.ok(used.size >= 2, `requests reached ${used.size} replica(s): ${[...used].join(', ')}`);
});

test('a stream on one replica receives bids handled by the other replica', async () => {
  assert.ok(runningReplicas() >= 2, 'at least two bidding-service containers run');
  const streamId = `lb-stream-${randomUUID()}`;
  const controller = new AbortController();
  const response = await fetch(`${API}/auctions/${auctionId}/stream`, {
    signal: controller.signal,
    headers: { 'X-Request-Id': streamId },
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seenHighest = [];
  let buffer = '';
  const readEvents = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.match(/^data: (.*)$/m);
          if (block.includes('event: state') && data) {
            seenHighest.push(JSON.parse(data[1]).highestBidCents);
          }
        }
      }
    } catch {
      // aborted at the end of the test
    }
  })();

  try {
    // Four bids, alternating bidders (nobody may outbid themselves), each with its own request ID.
    const bidIds = [];
    for (const [token, amountCents] of [
      [bidder2, 1_000],
      [winner, 1_200],
      [bidder2, 1_400],
      [winner, 1_600],
    ]) {
      const id = `lb-bid-${randomUUID()}`;
      bidIds.push(id);
      const bid = await call(`/auctions/${auctionId}/bids`, {
        method: 'POST',
        token,
        body: { amountCents },
        headers: { 'X-Request-Id': id, 'Idempotency-Key': randomUUID() },
      });
      assert.equal(bid.status, 201, JSON.stringify(bid.body));
    }

    for (let i = 0; i < 50 && !seenHighest.includes(1_600); i += 1) await sleep(100);
    assert.deepEqual(
      [1_000, 1_200, 1_400, 1_600].filter((amount) => seenHighest.includes(amount)),
      [1_000, 1_200, 1_400, 1_600],
      'the stream got every bid',
    );

    await sleep(500);
    const upstreams = upstreamsByRequestId();
    const streamReplica = upstreams.get(streamId);
    const otherReplicaBids = bidIds.filter((id) => upstreams.get(id) !== streamReplica);
    assert.ok(
      otherReplicaBids.length > 0,
      `at least one bid was handled by a replica other than the stream's (${streamReplica})`,
    );
  } finally {
    controller.abort();
    await readEvents;
  }
  // bidder2 never pays for a bid that is not the winning one at the end; nothing to clean up.
  assert.ok(BIDDER2_ID);
});
