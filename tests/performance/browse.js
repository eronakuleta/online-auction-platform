import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 30,
  duration: '15s',
  insecureSkipTLSVerify: true, // Local self-signed gateway, never production.
  thresholds: { http_req_failed: ['rate<0.01'], checks: ['rate==1'] },
};

export default function () {
  const base = __ENV.BASE_URL || 'https://host.docker.internal:8443/api/v1';
  // Keep request shapes identical across cache/replica comparisons.
  const responses = http.batch([
    ['GET', `${base}/auctions?size=20`],
    ['GET', `${base}/auctions/${__ENV.AUCTION_ID}/state`],
  ]);
  for (const res of responses) check(res, { 'read returns 200': (r) => r.status === 200 });
}
