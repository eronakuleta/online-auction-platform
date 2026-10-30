import type { AuthUser, Role } from './claims';

/**
 * True if the user holds at least one of the allowed roles. `requireRole()` middleware uses
 * this; ownership ("is this my auction?") is checked in each service's business layer instead.
 */
export function hasAnyRole(user: AuthUser, allowedRoles: readonly Role[]): boolean {
  if (allowedRoles.length === 0) {
    throw new Error('hasAnyRole needs at least one allowed role');
  }
  return allowedRoles.some((role) => user.roles.includes(role));
}
