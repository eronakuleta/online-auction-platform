import { createHash, randomBytes, type KeyObject } from 'node:crypto';
import type { Role } from '@auction/shared-auth';
import jwt from 'jsonwebtoken';

export interface AccessTokenSigner {
  sign(user: { id: string; roles: Role[] }): string;
  ttlSeconds: number;
}

/** Only auth-service has the private key. All other services verify with the public key. */
export function createAccessTokenSigner(options: {
  privateKey: KeyObject;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}): AccessTokenSigner {
  const { privateKey, issuer, audience, ttlSeconds } = options;
  return {
    ttlSeconds,
    sign: (user) =>
      jwt.sign({ roles: user.roles }, privateKey, {
        algorithm: 'RS256',
        subject: user.id,
        issuer,
        audience,
        expiresIn: ttlSeconds,
      }),
  };
}

/** A refresh token is 256 random bits. Only its hash is stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
