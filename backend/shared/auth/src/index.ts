// Public API of @auction/shared-auth.
export { ROLES, accessTokenClaimsSchema } from './claims';
export type { AccessTokenClaims, AuthUser, Role } from './claims';
export { TokenVerificationError } from './errors';
export type { TokenRejectionReason } from './errors';
export { extractBearerToken } from './bearer';
export { loadPublicKey } from './public-key';
export { createTokenVerifier } from './verify-token';
export type { TokenVerifier, TokenVerifierOptions } from './verify-token';
export { hasAnyRole } from './roles';
export { authenticate, getAuthUser, requireRole } from './middleware';
