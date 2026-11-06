// Unit tests for access and refresh tokens (task A-09). The access token is checked with the same
// shared verifier every other service uses, so these tests prove the two sides agree.
import { generateKeyPairSync } from 'node:crypto';
import { createTokenVerifier } from '@auction/shared-auth';
import jwt from 'jsonwebtoken';
import {
  createAccessTokenSigner,
  generateRefreshToken,
  hashRefreshToken,
} from '../services/tokens';

const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';
const USER_ID = '00000000-0000-4000-8000-000000000003';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signer = createAccessTokenSigner({
  privateKey,
  issuer: ISSUER,
  audience: AUDIENCE,
  ttlSeconds: 900,
});

describe('access tokens', () => {
  it('are RS256 tokens with the user, roles, issuer, audience and a 15-minute lifetime', () => {
    const token = signer.sign({ id: USER_ID, roles: ['BIDDER', 'SELLER'] });
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.payload).toMatchObject({
      sub: USER_ID,
      roles: ['BIDDER', 'SELLER'],
      iss: ISSUER,
      aud: AUDIENCE,
    });
    const { iat, exp } = decoded?.payload as { iat: number; exp: number };
    expect(exp - iat).toBe(900);
  });

  it('are accepted by the shared verifier that the other services use', () => {
    const verify = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });

    expect(verify(signer.sign({ id: USER_ID, roles: ['BIDDER'] }))).toEqual({
      id: USER_ID,
      roles: ['BIDDER'],
    });
  });

  it('are refused when signed with another key, or meant for another audience', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const verify = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
    const foreign = createAccessTokenSigner({
      privateKey: other.privateKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 900,
    });
    const wrongAudience = createAccessTokenSigner({
      privateKey,
      issuer: ISSUER,
      audience: 'another-app',
      ttlSeconds: 900,
    });

    expect(() => verify(foreign.sign({ id: USER_ID, roles: ['BIDDER'] }))).toThrow();
    expect(() => verify(wrongAudience.sign({ id: USER_ID, roles: ['BIDDER'] }))).toThrow();
  });
});

describe('refresh tokens', () => {
  it('are 256 random bits, URL-safe, and never repeat', () => {
    const tokens = Array.from({ length: 1000 }, generateRefreshToken);

    expect(new Set(tokens).size).toBe(1000);
    for (const token of tokens.slice(0, 10)) {
      // 32 bytes in base64url without padding is 43 characters.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('are stored as a SHA-256 hash: the same token always gives the same hash, others differ', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(hashRefreshToken(generateRefreshToken()));
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});
