// Generates the RS256 key pair for JWTs: `npm run gen-keys` (add `-- --force` to replace keys).
// Written in Node instead of shell so it works the same on Windows, macOS and Linux.
// The keys go to ./secrets/, which is gitignored. Only auth-service may mount the private key.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = join(process.cwd(), 'secrets');
const privatePath = join(outputDir, 'jwt_private.pem');
const publicPath = join(outputDir, 'jwt_public.pem');
const force = process.argv.includes('--force');

if (!force && (existsSync(privatePath) || existsSync(publicPath))) {
  process.stderr.write(
    `Keys already exist in ${outputDir}. Re-run with --force to replace them ` +
      '(this invalidates every issued token).\n',
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

mkdirSync(outputDir, { recursive: true });
// 0o600: readable only by the owner (ignored on Windows, which has no POSIX modes).
writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath, publicKey, { mode: 0o644 });

process.stdout.write(`Wrote ${privatePath}\nWrote ${publicPath}\n`);
