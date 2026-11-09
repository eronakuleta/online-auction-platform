import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const fixture = JSON.parse(open('/fixtures/bidders.json'));
const accepted = new Counter('bids_accepted');
const conflicts = new Counter('bids_conflicted');
export const options = {
  scenarios: {
    concurrent_bids: { executor: 'per-vu-iterations', vus: 500, iterations: 1, maxDuration: '30s' },
  },
  insecureSkipTLSVerify: true,
  // A business-rule 409 is expected; 429/5xx and transport failures fail checks.
  thresholds: { checks: ['rate==1'], bids_accepted: ['count>0'], iterations: ['count==500'] },
};

export default function () {
  const bidder = fixture.bidders[__VU - 1];
  const response = http.post(
    `${__ENV.BASE_URL || 'https://host.docker.internal:8443/api/v1'}/auctions/${__ENV.AUCTION_ID}/bids`,
    JSON.stringify({ amountCents: 1000 + __VU * 100 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bidder.token}`,
        'Idempotency-Key': `perf-${__ENV.AUCTION_ID}-${__VU}`,
      },
      responseCallback: http.expectedStatuses(201, 409),
    },
  );
  check(response, {
    'accepted or valid bid-too-low conflict': (r) =>
      r.status === 201 || (r.status === 409 && r.json('error.code') === 'BID_TOO_LOW'),
  });
  if (response.status === 201) accepted.add(1);
  if (response.status === 409) conflicts.add(1);
}
