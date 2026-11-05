import type { User } from '../repositories/user.repository';

/** What clients may see of a user. The password hash is never included. */
export function toUserResponse(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
