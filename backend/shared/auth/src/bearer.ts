import { TokenVerificationError } from './errors';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

/** Reads the JWT from an `Authorization: Bearer <token>` header value. */
export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new TokenVerificationError('MISSING', 'Authorization header is missing');
  }
  const match = BEARER_PATTERN.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw new TokenVerificationError('MALFORMED', 'Authorization header is not a Bearer JWT');
  }
  return match[1];
}
