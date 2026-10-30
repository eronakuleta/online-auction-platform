// Public API of @auction/shared-auth.
// The Express middleware (authenticate, requireRole) is added once the shared error classes
// from task B-02 exist, so 401/403 responses use the standard error format.
export { ROLES, accessTokenClaimsSchema } from './claims';
export type { AccessTokenClaims, AuthUser, Role } from './claims';
export { TokenVerificationError } from './errors';
export type { TokenRejectionReason } from './errors';
export { extractBearerToken } from './bearer';
export { loadPublicKey } from './public-key';
export { createTokenVerifier } from './verify-token';
export type { TokenVerifier, TokenVerifierOptions } from './verify-token';
export { hasAnyRole } from './roles';
