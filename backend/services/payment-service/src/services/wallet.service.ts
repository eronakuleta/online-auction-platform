import { NotFoundError, type Logger } from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction } from '../repositories/database';
import {
  createWalletIfMissing,
  depositIntoWallet,
  findWalletByUserId,
  listLedgerEntries,
  type LedgerEntry,
  type Wallet,
} from '../repositories/wallet.repository';

export interface WalletServiceDependencies {
  pool: Pool;
  /** The platform has one currency (docs/events.md §10), so every wallet uses it. */
  currency: string;
  logger: Logger;
}

export interface FundsCheck {
  userId: string;
  amountCents: number;
  balanceCents: number;
  sufficient: boolean;
}

export function createWalletService(deps: WalletServiceDependencies) {
  const { pool, currency, logger } = deps;

  /**
   * The user's wallet, created empty if it is missing (decision Q11). user.registered normally
   * creates it, but that event can be lost (docs/events.md §7), and the user must not be stuck.
   */
  async function ownWallet(userId: string): Promise<Wallet> {
    const existing = await findWalletByUserId(pool, userId);
    if (existing) {
      return existing;
    }
    if (await createWalletIfMissing(pool, userId, currency)) {
      logger.warn({ userId }, 'wallet was missing and has been created on first use');
    }
    const created = await findWalletByUserId(pool, userId);
    if (!created) {
      throw new Error(`Wallet of user ${userId} is missing right after creating it`);
    }
    return created;
  }

  return {
    getOwnWallet: ownWallet,

    /** A simulated deposit: no real payment provider, the money simply appears (FR-11). */
    async deposit(userId: string, amountCents: number) {
      const wallet = await ownWallet(userId);
      const result = await withTransaction(pool, (transaction) =>
        depositIntoWallet(transaction, wallet.id, amountCents),
      );
      logger.info(
        { userId, walletId: wallet.id, amountCents, balanceCents: result.wallet.balanceCents },
        'deposit made',
      );
      return result;
    },

    async listTransactions(
      userId: string,
      query: { page: number; size: number },
    ): Promise<{ entries: LedgerEntry[]; page: number; size: number; total: number }> {
      const wallet = await ownWallet(userId);
      const { entries, total } = await listLedgerEntries(pool, wallet.id, {
        limit: query.size,
        offset: (query.page - 1) * query.size,
      });
      return { entries, page: query.page, size: query.size, total };
    },

    /**
     * Answers bidding-service before it places a bid (decision Q10). It only reads: funds are not
     * held, which is the known limitation in ROADMAP §2. No wallet is created here, because this
     * is another service asking, not the user.
     */
    async checkFunds(userId: string, amountCents: number): Promise<FundsCheck> {
      const wallet = await findWalletByUserId(pool, userId);
      if (!wallet) {
        throw new NotFoundError('This user has no wallet', 'WALLET_NOT_FOUND');
      }
      const sufficient = wallet.balanceCents >= amountCents;
      logger.debug({ userId, amountCents, sufficient }, 'funds checked');
      return { userId, amountCents, balanceCents: wallet.balanceCents, sufficient };
    },

    /** user.registered: every new user gets an empty wallet. Repeating the event changes nothing. */
    async createWalletForNewUser(userId: string): Promise<void> {
      const created = await createWalletIfMissing(pool, userId, currency);
      logger.info({ userId, created }, created ? 'wallet created' : 'wallet already existed');
    },
  };
}

export type WalletService = ReturnType<typeof createWalletService>;
