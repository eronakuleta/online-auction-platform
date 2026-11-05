import { createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MIN_RSA_BITS = 2048;

/**
 * Loads the RS256 public key at service start-up and fails fast if it is unusable.
 * A private key is rejected on purpose: only auth-service may hold it (CLAUDE.md, security rules).
 */
export function loadPublicKey(path: string): KeyObject {
  let pem: string;
  try {
    pem = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`JWT public key not found at ${path}. Run npm run gen-keys.`);
  }

  if (pem.includes('PRIVATE KEY')) {
    throw new Error(`${path} contains a private key. Services may only load the public key.`);
  }

  const key = createPublicKey(pem);
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== 'rsa' || bits < MIN_RSA_BITS) {
    throw new Error(`${path} must be an RSA public key of at least ${MIN_RSA_BITS} bits.`);
  }
  return key;
}
