import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/performance/results/correctness.json';
const evidence = JSON.parse(readFileSync(path, 'utf8'));
// Run inside the owning service's network/config. The auction ID is a bound SQL parameter.
const script = `
  import pg from 'pg';
  const db = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT), user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.BIDDING_DB_NAME });
  await db.connect();
  try {
    const result = await db.query('SELECT highest_bid_cents::text, highest_bidder_id, bid_count, status FROM auction_state WHERE auction_id = $1', [process.argv[1]]);
    const bids = await db.query('SELECT sequence, amount_cents::text, bidder_id FROM bids WHERE auction_id = $1 ORDER BY sequence', [process.argv[1]]);
    process.stdout.write(JSON.stringify({ state: result.rows[0], bids: bids.rows }));
  } finally { await db.end(); }
`;
const result = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'bidding-service',
      'node',
      '--input-type=module',
      '-e',
      script,
      evidence.auctionId,
    ],
    { encoding: 'utf8' },
  ),
);
assert.equal(result.state.status, 'CLOSED_SOLD');
assert.equal(result.bids.length, evidence.accepted);
assert.equal(result.state.bid_count, result.bids.length);
result.bids.forEach((bid, i) => {
  assert.equal(bid.sequence, i + 1);
  if (i > 0) assert.ok(Number(bid.amount_cents) > Number(result.bids[i - 1].amount_cents));
});
const last = result.bids.at(-1);
assert.equal(Number(last.amount_cents), evidence.highestBidCents);
assert.equal(result.state.highest_bid_cents, last.amount_cents);
assert.equal(result.state.highest_bidder_id, last.bidder_id);
evidence.databaseVerified = true;
evidence.databaseVerifiedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(
  'Database verified: one highest bidder, contiguous sequence and matching maximum amount\n',
);
