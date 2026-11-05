import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createTokenVerifier, TokenVerificationError, type TokenRejectionReason } from '../index';

const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';

const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

const verify = createTokenVerifier({
  publicKey: trusted.publicKey,
  issuer: ISSUER,
  audience: AUDIENCE,
});

const userId = randomUUID();

function signToken(
  claims: Record<string, unknown> = { sub: userId, roles: ['BIDDER'] },
  options: jwt.SignOptions = {},
  key = trusted.privateKey,
): string {
  return jwt.sign(claims, key, {
    algorithm: 'RS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: 900,
    ...options,
  });
}

function base64url(value: object | string): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(text).toString('base64url');
}

function expectRejected(token: string, reason: TokenRejectionReason): void {
  try {
    verify(token);
  } catch (error) {
    expect(error).toBeInstanceOf(TokenVerificationError);
    expect((error as TokenVerificationError).reason).toBe(reason);
    return;
  }
  throw new Error('expected the token to be rejected');
}

describe('createTokenVerifier', () => {
  it('returns the user for a valid token', () => {
    const token = signToken({ sub: userId, roles: ['BIDDER', 'SELLER'] });
    expect(verify(token)).toEqual({ id: userId, roles: ['BIDDER', 'SELLER'] });
  });

  it('rejects an expired token as EXPIRED', () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 3600;
    const token = signToken({ sub: userId, roles: ['BIDDER'], iat: issuedAt }, { expiresIn: 60 });
    expectRejected(token, 'EXPIRED');
  });

  it('accepts a token that expired within the clock tolerance', () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 62;
    const token = signToken({ sub: userId, roles: ['BIDDER'], iat: issuedAt }, { expiresIn: 60 });
    expect(verify(token).id).toBe(userId);
  });

  it('rejects a token signed with another private key (forged)', () => {
    expectRejected(signToken(undefined, {}, attacker.privateKey), 'INVALID');
  });

  it('rejects a token whose payload was changed after signing', () => {
    const [header, , signature] = signToken().split('.');
    const now = Math.floor(Date.now() / 1000);
    const tampered = base64url({
      sub: userId,
      roles: ['ADMIN'],
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 900,
    });
    expectRejected(`${header}.${tampered}.${signature}`, 'INVALID');
  });

  it('rejects an unsigned token with alg "none"', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({
      sub: userId,
      roles: ['ADMIN'],
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 900,
    });
    expectRejected(`${header}.${payload}.`, 'INVALID');
  });

  it('rejects an HS256 token signed with the public key as secret (algorithm confusion)', () => {
    const now = Math.floor(Date.now() / 1000);
    const publicPem = trusted.publicKey.export({ type: 'spki', format: 'pem' });
    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    const payload = base64url({
      sub: userId,
      roles: ['ADMIN'],
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + 900,
    });
    const signature = createHmac('sha256', publicPem)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expectRejected(`${header}.${payload}.${signature}`, 'INVALID');
  });

  it('rejects a token from another issuer', () => {
    expectRejected(signToken(undefined, { issuer: 'someone-else' }), 'INVALID');
  });

  it('rejects a token for another audience', () => {
    expectRejected(signToken(undefined, { audience: 'other-app' }), 'INVALID');
  });

  it('rejects a token without exp', () => {
    const token = jwt.sign({ sub: userId, roles: ['BIDDER'] }, trusted.privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expectRejected(token, 'INVALID');
  });

  it.each([
    ['sub is not a UUID', { sub: 'user-1', roles: ['BIDDER'] }],
    ['roles is missing', { sub: userId }],
    ['roles is empty', { sub: userId, roles: [] }],
    ['roles contains an unknown role', { sub: userId, roles: ['SUPERUSER'] }],
  ])('rejects a validly signed token when %s', (_case, claims) => {
    expectRejected(signToken(claims), 'INVALID');
  });

  it('rejects text that is not a JWT', () => {
    expectRejected('not-a-token', 'INVALID');
  });
});
