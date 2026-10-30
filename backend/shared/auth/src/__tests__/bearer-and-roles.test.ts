import { randomUUID } from 'node:crypto';
import { extractBearerToken, hasAnyRole, TokenVerificationError, type AuthUser } from '../index';

const SAMPLE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

function rejectionReason(header: string | undefined): string {
  try {
    extractBearerToken(header);
  } catch (error) {
    expect(error).toBeInstanceOf(TokenVerificationError);
    return (error as TokenVerificationError).reason;
  }
  return 'ACCEPTED';
}

describe('extractBearerToken', () => {
  it('returns the token from a Bearer header', () => {
    expect(extractBearerToken(`Bearer ${SAMPLE_JWT}`)).toBe(SAMPLE_JWT);
  });

  it('ignores surrounding whitespace', () => {
    expect(extractBearerToken(`  Bearer ${SAMPLE_JWT}  `)).toBe(SAMPLE_JWT);
  });

  it.each([undefined, ''])('treats %p as MISSING', (header) => {
    expect(rejectionReason(header)).toBe('MISSING');
  });

  it.each([
    ['another scheme', `Basic ${SAMPLE_JWT}`],
    ['lowercase scheme', `bearer ${SAMPLE_JWT}`],
    ['no token', 'Bearer '],
    ['not three parts', 'Bearer abc.def'],
    ['two tokens', `Bearer ${SAMPLE_JWT} ${SAMPLE_JWT}`],
    ['SQL in the header', "Bearer ' OR 1=1 --"],
  ])('treats %s as MALFORMED', (_case, header) => {
    expect(rejectionReason(header)).toBe('MALFORMED');
  });
});

describe('hasAnyRole', () => {
  const bidder: AuthUser = { id: randomUUID(), roles: ['BIDDER'] };
  const sellerAndBidder: AuthUser = { id: randomUUID(), roles: ['BIDDER', 'SELLER'] };

  it('allows a user who holds the role', () => {
    expect(hasAnyRole(sellerAndBidder, ['SELLER'])).toBe(true);
  });

  it('allows a user who holds any one of several roles', () => {
    expect(hasAnyRole(bidder, ['SELLER', 'BIDDER'])).toBe(true);
  });

  it('refuses a user without the role', () => {
    expect(hasAnyRole(bidder, ['SELLER'])).toBe(false);
    expect(hasAnyRole(sellerAndBidder, ['ADMIN'])).toBe(false);
  });

  it('throws when called without roles, so a route is never accidentally open', () => {
    expect(() => hasAnyRole(bidder, [])).toThrow();
  });
});
