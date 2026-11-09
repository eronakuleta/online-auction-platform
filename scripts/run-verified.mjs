import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const script = process.argv[2];
execFileSync(process.execPath, [`scripts/${script}.mjs`, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_EXTRA_CA_CERTS: resolve('gateway/certs/cert.pem') },
});
