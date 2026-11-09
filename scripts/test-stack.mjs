import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const suites = [
  'gateway-smoke',
  '../security/security.e2e',
  'auction-events.e2e',
  'wallet.e2e',
  'settlement.e2e',
  'lifecycle.e2e',
  'load-balancing.e2e',
  'observability.e2e',
];
for (const suite of suites) {
  const file = suite.includes('/') ? `tests/${suite.slice(3)}.mjs` : `tests/e2e/${suite}.mjs`;
  execFileSync(process.execPath, ['--test', file], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: resolve('gateway/certs/cert.pem') },
  });
}
