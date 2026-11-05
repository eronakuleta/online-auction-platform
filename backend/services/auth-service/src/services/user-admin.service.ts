import type { Role } from '@auction/shared-auth';
import { ConflictError, NotFoundError, type Logger } from '@auction/shared-common';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../repositories/database';
import { revokeAllUserTokens } from '../repositories/refresh-token.repository';
import {
  findUserById,
  findUserForUpdate,
  listUsers,
  replaceUserRoles,
  updateUserStatus,
  type User,
  type UserStatus,
} from '../repositories/user.repository';

export interface UserAdminServiceDependencies {
  pool: Pool;
  logger: Logger;
}

/** Locks the target of an admin action, and refuses accounts this API must not change (Q6). */
async function lockChangeableUser(transaction: PoolClient, userId: string): Promise<User> {
  const user = await findUserForUpdate(transaction, userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  if (user.roles.includes('ADMIN')) {
    throw new ConflictError('ADMIN_ACCOUNT_PROTECTED', 'Admin accounts cannot be changed here');
  }
  return user;
}

async function requireUser(transaction: PoolClient, userId: string): Promise<User> {
  const user = await findUserById(transaction, userId);
  if (!user) {
    throw new Error(`User ${userId} disappeared inside its own transaction`);
  }
  return user;
}

export function createUserAdminService(deps: UserAdminServiceDependencies) {
  const { pool, logger } = deps;

  return {
    async list(options: { page: number; size: number; status?: UserStatus }) {
      const { users, total } = await listUsers(pool, {
        status: options.status,
        limit: options.size,
        offset: (options.page - 1) * options.size,
      });
      return { users, page: options.page, size: options.size, total };
    },

    /**
     * Banning ends every session in the same transaction: the user cannot log in or refresh. An
     * access token already issued stays valid until it expires, at most 15 minutes (a documented
     * limitation). Unbanning does not bring old sessions back; the user logs in again.
     */
    async setStatus(adminId: string, userId: string, status: UserStatus): Promise<User> {
      const user = await withTransaction(pool, async (transaction) => {
        await lockChangeableUser(transaction, userId);
        await updateUserStatus(transaction, userId, status);
        if (status === 'BANNED') {
          await revokeAllUserTokens(transaction, userId);
        }
        return requireUser(transaction, userId);
      });
      logger.info({ adminId, userId, status }, 'user status changed');
      return user;
    },

    /** The only way to become a SELLER (Q1). Applies at the user's next login or refresh. */
    async setRoles(adminId: string, userId: string, roles: Role[]): Promise<User> {
      const user = await withTransaction(pool, async (transaction) => {
        await lockChangeableUser(transaction, userId);
        await replaceUserRoles(transaction, userId, roles);
        return requireUser(transaction, userId);
      });
      logger.info({ adminId, userId, roles }, 'user roles changed');
      return user;
    },
  };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
