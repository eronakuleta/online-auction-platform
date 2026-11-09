import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// Run with NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem (npm run perf supplies it via wrapper).
const API = 'https://localhost:8443/api/v1';
const composeArgs = [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'tests/performance/compose.perf.yml',
];
const compose = (...args) =>
  execFileSync('docker', [...composeArgs, ...args], { stdio: 'inherit' });
const call = async (path, method = 'GET', token, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value;
};
const login = async (email, password) =>
  (await call('/auth/login', 'POST', undefined, { email, password })).accessToken;
mkdirSync('temp/performance', { recursive: true });
mkdirSync('tests/performance/results', { recursive: true });

try {
  compose('up', '-d', '--wait', 'gateway', 'bidding-service');
  // Prepare 500 REAL registered bidders and their funded wallets through public APIs.
  // The secret fixture is ignored and is never part of the report or archive.
  const fixturePath = 'temp/performance/bidders.json';
  let fixture;
  if (existsSync(fixturePath)) fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!fixture || fixture.createdAt < Date.now() - 600_000) {
    const bidders = [];
    for (let offset = 0; offset < 500; offset += 5) {
      bidders.push(
        ...(await Promise.all(
          Array.from({ length: 5 }, async () => {
            const email = `perf-${randomUUID()}@auction.test`,
              password = 'Performance#2026';
            const user = await call('/auth/register', 'POST', undefined, {
              email,
              password,
              displayName: 'Load test bidder',
            });
            const token = await login(email, password);
            await call('/wallet/deposit', 'POST', token, { amountCents: 100_000 });
            return { id: user.id, token };
          }),
        )),
      );
      if (bidders.length % 100 === 0)
        process.stdout.write(`Prepared ${bidders.length}/500 bidders\n`);
    }
    fixture = { createdAt: Date.now(), bidders };
    writeFileSync(fixturePath, JSON.stringify(fixture));
  }
  const seller = await login('seller@auction.test', 'Seller#Demo2026');
  const publish = async (seconds) => {
    const auction = await call('/auctions', 'POST', seller, {
      title: `Measured load ${randomUUID().slice(0, 8)}`,
      categoryId: '20000000-0000-4000-8000-000000000003',
      startingPriceCents: 1000,
      minIncrementCents: 100,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + seconds * 1000).toISOString(),
    });
    await call(`/auctions/${auction.id}/publish`, 'POST', seller);
    await sleep(1000);
    return auction.id;
  };
  const k6 = (script, label, auctionId) => {
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network=auction-backend',
        '-e',
        'BASE_URL=https://gateway/api/v1',
        '-v',
        `${resolve('tests/performance')}:/scripts`,
        '-v',
        `${resolve('temp/performance')}:/fixtures:ro`,
        '-e',
        `AUCTION_ID=${auctionId}`,
        'grafana/k6:0.57.0',
        'run',
        `--summary-export=/scripts/results/${label}.json`,
        `/scripts/${script}.js`,
      ],
      { encoding: 'utf8', maxBuffer: 10_000_000 },
    );
    writeFileSync(
      `tests/performance/results/${label}.txt`,
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
    process.stdout.write(result.stdout ?? '');
    assert.equal(result.status, 0, `k6 failed: see tests/performance/results/${label}.txt`);
  };
  const comparisons = process.argv.includes('--bids-only')
    ? []
    : [
        ['browse-no-cache', 2, 'false'],
        ['browse-one-replica', 1, 'true'],
        ['browse-two-replicas', 2, 'true'],
      ];
  const browsing = comparisons.length ? await publish(600) : undefined;
  for (const [label, replicas, cache] of comparisons) {
    process.env.STATE_CACHE_ENABLED = cache;
    process.env.BIDDING_REPLICAS = String(replicas);
    compose('up', '-d', '--wait', 'bidding-service');
    // Allow gateway Docker DNS caching and replica replacement to settle before measurement.
    await sleep(12000);
    k6('browse', label, browsing);
  }
  // Reusing the fixture must not leave a previous winner short of funds on the next run.
  for (let offset = 0; offset < fixture.bidders.length; offset += 5) {
    await Promise.all(
      fixture.bidders
        .slice(offset, offset + 5)
        .map((bidder) => call('/wallet/deposit', 'POST', bidder.token, { amountCents: 100_000 })),
    );
  }
  const auctionId = await publish(60);
  k6('bids', 'bids-500', auctionId);
  let state;
  for (let i = 0; i < 100; i += 1) {
    state = await call(`/auctions/${auctionId}/state`);
    if (state.status === 'CLOSED_SOLD') break;
    await sleep(1000);
  }
  assert.equal(state.status, 'CLOSED_SOLD');
  assert.equal(state.highestBidCents, 51000);
  assert.equal(state.highestBidderId, fixture.bidders[499].id);
  const history = await call(`/auctions/${auctionId}/bids?size=100`);
  assert.equal(history.total, state.bidCount);
  // The public history is descending; reverse to assert one strictly increasing accepted order.
  const bids = [...history.data].sort((a, b) => a.sequence - b.sequence);
  assert.equal(bids.length, history.total, 'load history must fit this verification page');
  bids.forEach((bid, i) => {
    assert.equal(bid.sequence, i + 1);
    if (i > 0) assert.ok(bid.amountCents > bids[i - 1].amountCents);
  });
  const result = {
    recordedAt: new Date().toISOString(),
    requests: 500,
    auctionId,
    accepted: state.bidCount,
    highestBidCents: state.highestBidCents,
    consistentSequence: true,
    winnerMatchesMaximumBid: true,
    finalStatus: state.status,
  };
  writeFileSync('tests/performance/results/correctness.json', JSON.stringify(result, null, 2));
  execFileSync(process.execPath, ['scripts/verify-load-database.mjs'], { stdio: 'inherit' });
} finally {
  // Always restore the normal gateway protection, cache and two-replica configuration.
  delete process.env.STATE_CACHE_ENABLED;
  delete process.env.BIDDING_REPLICAS;
  execFileSync('docker', ['compose', 'up', '-d', '--wait', 'gateway', 'bidding-service'], {
    stdio: 'inherit',
  });
}
