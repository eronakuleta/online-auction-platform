import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id });
}

// Hash of a random value that nobody knows. Created once, on the first failed lookup.
let unmatchableHash: Promise<string> | undefined;

/**
 * Checks a password. With no user (unknown email) it still does the same slow work against a dummy
 * hash, so the response time does not reveal whether an email is registered.
 */
export async function passwordMatches(
  passwordHash: string | undefined,
  password: string,
): Promise<boolean> {
  if (passwordHash) {
    return verify(passwordHash, password);
  }
  unmatchableHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verify(await unmatchableHash, password);
  return false;
}
