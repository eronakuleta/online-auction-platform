import { authenticate, type TokenVerifier } from '@auction/shared-auth';
import type { RequestHandler } from 'express';

/**
 * For public pages that show more to a logged-in user. No token means a visitor. A token that is
 * present must be valid, so a client with an expired token gets a 401 and knows to refresh, instead
 * of quietly seeing the visitor's version of the page.
 */
export function optionalAuthenticate(verifyToken: TokenVerifier): RequestHandler {
  const required = authenticate(verifyToken);
  return (req, res, next) => {
    if (req.get('authorization') === undefined) {
      next();
      return;
    }
    required(req, res, next);
  };
}
