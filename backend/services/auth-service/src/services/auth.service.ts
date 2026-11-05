import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  type Logger,
  type Publish,
} from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction, type Queryable } from '../repositories/database';
import {
  findRefreshTokenForUpdate,
  insertRefreshToken,
  markRefreshTokenReplaced,
  revokeFamilyOfToken,
  revokeTokenFamily,
} from '../repositories/refresh-token.repository';
import {
  findUserByEmail,
  findUserById,
  insertUserWithRole,
  updateDisplayName,
  type User,
} from '../repositories/user.repository';
import { hashPassword, passwordMatches } from './passwords';
import { generateRefreshToken, hashRefreshToken, type AccessTokenSigner } from './tokens';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthServiceDependencies {
  pool: Pool;
  signer: AccessTokenSigner;
  refreshTtlSeconds: number;
  publish: Publish;
  logger: Logger;
}

// Login gives the same answer for every failure, so nobody can find out which emails exist.
const invalidCredentials = () =>
  new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
const invalidRefreshToken = () =>
  new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');

export function createAuthService(deps: AuthServiceDependencies) {
  const { pool, signer, refreshTtlSeconds, publish, logger } = deps;

  /** Stores a new refresh token (only its hash) and returns the raw value once. */
  async function issueRefreshToken(db: Queryable, userId: string, familyId: string) {
    const refreshToken = generateRefreshToken();
    const id = await insertRefreshToken(db, {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      ttlSeconds: refreshTtlSeconds,
    });
    return { id, refreshToken };
  }

  function tokenPair(user: User, refreshToken: string): TokenPair {
    return { accessToken: signer.sign(user), refreshToken, expiresIn: signer.ttlSeconds };
  }

  return {
    /** Every new user is a plain BIDDER. Only an admin can grant SELLER (decision Q1). */
    async register(input: { email: string; password: string; displayName: string }): Promise<User> {
      const passwordHash = await hashPassword(input.password);
      const user = await withTransaction(pool, (transaction) =>
        insertUserWithRole(transaction, {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          role: 'BIDDER',
        }),
      );
      if (!user) {
        throw new ConflictError('EMAIL_TAKEN', 'This email is already registered');
      }
      logger.info({ userId: user.id }, 'user registered');

      // After the commit, as the contract requires. The account already exists, so a broker failure
      // must not turn this into an error. The lost event is a known limitation (docs/events.md §7).
      try {
        await publish('user.registered', { userId: user.id, displayName: user.displayName });
      } catch (err) {
        logger.error({ err, userId: user.id }, 'could not publish user.registered');
      }
      return user;
    },

    async login(input: { email: string; password: string }) {
      const user = await findUserByEmail(pool, input.email);
      const matches = await passwordMatches(user?.passwordHash, input.password);
      if (!user || !matches || user.status !== 'ACTIVE') {
        logger.info('login rejected');
        throw invalidCredentials();
      }
      const { refreshToken } = await issueRefreshToken(pool, user.id, randomUUID());
      logger.info({ userId: user.id }, 'user logged in');
      return { user, tokens: tokenPair(user, refreshToken) };
    },

    /**
     * Rotation: a refresh token works once and is replaced by a new one. If a used token comes
     * back, it may have been stolen, so the whole family is revoked and the user logs in again.
     * Failures return null instead of throwing, so the revocation is committed, not rolled back.
     */
    async refresh(presentedToken: string): Promise<TokenPair> {
      const outcome = await withTransaction(pool, async (transaction) => {
        const stored = await findRefreshTokenForUpdate(
          transaction,
          hashRefreshToken(presentedToken),
        );
        if (!stored || stored.expired) {
          return null;
        }
        if (stored.revoked) {
          await revokeTokenFamily(transaction, stored.familyId);
          logger.warn({ userId: stored.userId }, 'refresh token reused, family revoked');
          return null;
        }
        const user = await findUserById(transaction, stored.userId);
        if (!user || user.status !== 'ACTIVE') {
          await revokeTokenFamily(transaction, stored.familyId);
          return null;
        }
        const next = await issueRefreshToken(transaction, user.id, stored.familyId);
        await markRefreshTokenReplaced(transaction, stored.id, next.id);
        return { user, refreshToken: next.refreshToken };
      });
      if (!outcome) {
        throw invalidRefreshToken();
      }
      return tokenPair(outcome.user, outcome.refreshToken);
    },

    /** Always succeeds, so the answer does not reveal whether a token exists. */
    async logout(presentedToken: string): Promise<void> {
      await revokeFamilyOfToken(pool, hashRefreshToken(presentedToken));
    },

    async getProfile(userId: string): Promise<User> {
      const user = await findUserById(pool, userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      return user;
    },

    /** Only the display name can change (decision Q2). The schema rejects any other field. */
    async updateProfile(userId: string, input: { displayName: string }): Promise<User> {
      const user = await updateDisplayName(pool, userId, input.displayName);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      return user;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
