// Express middleware that protects routes. Errors are thrown as the shared AppError classes, so
// the shared error handler answers in the standard format (docs/events.md section 9).
import { ForbiddenError, UnauthorizedError } from '@auction/shared-common';
import type { Request, RequestHandler } from 'express';
import { extractBearerToken } from './bearer';
import type { AuthUser, Role } from './claims';
import { TokenVerificationError } from './errors';
import { hasAnyRole } from './roles';
import type { TokenVerifier } from './verify-token';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by authenticate(). Use getAuthUser() to read it in controllers. */
    user?: AuthUser;
  }
}

/**
 * Requires a valid access token and attaches the caller to the request. Every kind of bad token
 * gets the same 401 message, so a caller learns nothing about why it was refused.
 */
export function authenticate(verifyToken: TokenVerifier): RequestHandler {
  return (req, _res, next) => {
    try {
      req.user = verifyToken(extractBearerToken(req.get('authorization')));
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        throw new UnauthorizedError();
      }
      throw error;
    }
    next();
  };
}

/**
 * Requires at least one of the roles. Mount after authenticate(). Ownership ("is this my
 * auction?") needs the database, so each service checks it in its business layer instead.
 */
export function requireRole(...allowedRoles: Role[]): RequestHandler {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole needs at least one role');
  }
  return (req, _res, next) => {
    if (!hasAnyRole(getAuthUser(req), allowedRoles)) {
      throw new ForbiddenError();
    }
    next();
  };
}

/** The authenticated caller. Throws 401 if the route was not protected by authenticate(). */
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}
