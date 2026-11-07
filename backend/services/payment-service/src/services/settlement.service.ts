import type { DomainEvent, EventPayload, Logger, Publish } from '@auction/shared-common';
import type { Pool } from 'pg';
import { withTransaction } from '../repositories/database';
import {
  findPlatformWalletId,
  insertSettlement,
  listSettlements,
  lockWallets,
  moveMoney,
  type Settlement,
  type SettlementStatus,
} from '../repositories/settlement.repository';
import { createWalletIfMissing, findWalletByUserId } from '../repositories/wallet.repository';

// Settlement after a sale (FR-12, ROADMAP §4): one transaction debits the winner, credits the
// seller the amount minus the platform fee and credits the platform the fee, with a ledger row for
// each. It happens at most once per auction. Without enough money nothing moves.

export interface SettlementServiceDependencies {
  pool: Pool;
  /** PLATFORM_FEE_PERCENT, 0 to 100. */
  feePercent: number;
  currency: string;
  publish: Publish;
  logger: Logger;
}

/**
 * fee = floor(amount * percent / 100), seller = amount - fee (docs/events.md §4), so the two parts
 * always add up to the amount and rounding never creates or loses a cent. BigInt keeps the product
 * exact even for amounts near Number.MAX_SAFE_INTEGER.
 */
export function splitAmount(
  amountCents: number,
  feePercent: number,
): { feeCents: number; sellerCents: number } {
  const feeCents = Number((BigInt(amountCents) * BigInt(feePercent)) / 100n);
  return { feeCents, sellerCents: amountCents - feeCents };
}

export function createSettlementService(deps: SettlementServiceDependencies) {
  const { pool, feePercent, currency, publish, logger } = deps;

  async function announce<T extends 'payment.completed' | 'payment.failed'>(
    type: T,
    payload: EventPayload<T>,
  ): Promise<void> {
    try {
      await publish(type, payload);
    } catch (err) {
      // The settlement is committed and stays. The lost event is the known limitation without an
      // outbox (docs/events.md §7), so it is logged as an error to be noticed.
      logger.error(
        { err, eventType: type, auctionId: payload.auctionId },
        'could not publish event',
      );
    }
  }

  /** Runs the whole settlement in one transaction. Returns null if it was already settled. */
  function settle(sale: {
    auctionId: string;
    winnerId: string;
    sellerId: string;
    amountCents: number;
  }): Promise<Settlement | null> {
    return withTransaction(pool, async (tx) => {
      const base = { ...sale, currency };
      const winner = await findWalletByUserId(tx, sale.winnerId);
      if (!winner) {
        return insertSettlement(tx, {
          ...base,
          status: 'FAILED',
          failureReason: 'WALLET_NOT_FOUND',
        });
      }
      // The seller is paid even if their wallet was never created (Q11: wallets self-heal).
      await createWalletIfMissing(tx, sale.sellerId, currency);
      const seller = await findWalletByUserId(tx, sale.sellerId);
      const platformId = await findPlatformWalletId(tx);
      if (!seller || !platformId) {
        // The platform wallet is seeded; without it the database is broken. Throwing rolls back,
        // and the consumer retries, then dead-letters the event for a person to look at.
        throw new Error('The seller or the platform wallet is missing');
      }

      const balances = await lockWallets(tx, [winner.id, seller.id, platformId]);
      const winnerBalance = balances.get(winner.id) ?? 0;
      if (winnerBalance < sale.amountCents) {
        return insertSettlement(tx, {
          ...base,
          status: 'FAILED',
          failureReason: 'INSUFFICIENT_FUNDS',
        });
      }

      const split = splitAmount(sale.amountCents, feePercent);
      const settlement = await insertSettlement(tx, { ...base, status: 'COMPLETED', ...split });
      if (!settlement) return null;

      await moveMoney(tx, {
        walletId: winner.id,
        type: 'SETTLEMENT_DEBIT',
        amountCents: -sale.amountCents,
        settlementId: settlement.id,
      });
      // A part of 0 (a 100% fee, or a fee that rounds down to 0) writes no row: the ledger only
      // records real changes.
      if (split.sellerCents > 0) {
        await moveMoney(tx, {
          walletId: seller.id,
          type: 'SETTLEMENT_CREDIT',
          amountCents: split.sellerCents,
          settlementId: settlement.id,
        });
      }
      if (split.feeCents > 0) {
        await moveMoney(tx, {
          walletId: platformId,
          type: 'PLATFORM_FEE',
          amountCents: split.feeCents,
          settlementId: settlement.id,
        });
      }
      return settlement;
    });
  }

  return {
    /** auction.closed: settle a sale; a no-sale needs no payment. */
    async handleAuctionClosed(event: DomainEvent<'auction.closed'>): Promise<void> {
      const { payload } = event;
      if (payload.result !== 'SOLD') {
        logger.info(
          { auctionId: payload.auctionId },
          'auction closed without a sale, nothing to settle',
        );
        return;
      }
      if (payload.currency !== currency) {
        // One currency for the whole platform (docs/events.md §10). Retrying cannot fix this, but a
        // thrown error leaves the event in the dead-letter queue for a person to look at.
        throw new Error(`auction.closed in ${payload.currency}, but wallets are in ${currency}`);
      }

      const settlement = await settle({
        auctionId: payload.auctionId,
        winnerId: payload.winnerId,
        sellerId: payload.sellerId,
        amountCents: payload.amountCents,
      });
      if (!settlement) {
        logger.info({ auctionId: payload.auctionId }, 'auction already settled, event skipped');
        return;
      }

      const time = settlement.createdAt.toISOString();
      if (settlement.status === 'COMPLETED') {
        logger.info(
          {
            auctionId: payload.auctionId,
            amountCents: payload.amountCents,
            feeCents: settlement.feeCents,
          },
          'settlement completed',
        );
        await announce('payment.completed', {
          settlementId: settlement.id,
          auctionId: payload.auctionId,
          title: payload.title,
          winnerId: payload.winnerId,
          sellerId: payload.sellerId,
          amountCents: payload.amountCents,
          feeCents: settlement.feeCents ?? 0,
          sellerCents: settlement.sellerCents ?? 0,
          currency,
          settledAt: time,
        });
        return;
      }
      logger.warn(
        { auctionId: payload.auctionId, reason: settlement.failureReason },
        'settlement failed',
      );
      await announce('payment.failed', {
        auctionId: payload.auctionId,
        title: payload.title,
        winnerId: payload.winnerId,
        sellerId: payload.sellerId,
        amountCents: payload.amountCents,
        currency,
        reason: settlement.failureReason ?? 'INSUFFICIENT_FUNDS',
        failedAt: time,
      });
    },

    /** GET /payments for admins. */
    async list(query: { status?: SettlementStatus; page: number; size: number }) {
      const { settlements, total } = await listSettlements(pool, {
        status: query.status,
        limit: query.size,
        offset: (query.page - 1) * query.size,
      });
      return { settlements, page: query.page, size: query.size, total };
    },
  };
}

export type SettlementService = ReturnType<typeof createSettlementService>;
