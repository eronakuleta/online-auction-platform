import type { KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { accessTokenClaimsSchema, type AuthUser } from './claims';
import { TokenVerificationError } from './errors';

export interface TokenVerifierOptions {
  publicKey: KeyObject;
  issuer: string;
  audience: string;
  /** Allowed clock difference between services, in seconds. */
  clockToleranceSeconds?: number;
}

export type TokenVerifier = (token: string) => AuthUser;

/**
 * Builds a function that turns an access token into the authenticated user, or throws
 * TokenVerificationError. Only RS256 is accepted, which blocks `alg: none` and the
 * "HS256 signed with the public key" confusion attack.
 */
export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const { publicKey, issuer, audience, clockToleranceSeconds = 5 } = options;

  return (token: string): AuthUser => {
    let payload: unknown;
    try {
      payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer,
        audience,
        clockTolerance: clockToleranceSeconds,
      });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenVerificationError('EXPIRED', 'Access token has expired');
      }
      throw new TokenVerificationError('INVALID', 'Access token is invalid');
    }

    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new TokenVerificationError('INVALID', 'Access token claims are invalid');
    }

    return { id: claims.data.sub, roles: claims.data.roles };
  };
}
