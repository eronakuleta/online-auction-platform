import { getAuthUser } from '@auction/shared-auth';
import type { RequestHandler } from 'express';
import type { LedgerEntry, Wallet } from '../repositories/wallet.repository';
import {
  depositBodySchema,
  fundsCheckQuerySchema,
  transactionsQuerySchema,
} from '../schemas/wallet.schemas';
import type { WalletService } from '../services/wallet.service';

function toWalletResponse(wallet: Wallet) {
  return {
    id: wallet.id,
    userId: wallet.userId,
    balanceCents: wallet.balanceCents,
    currency: wallet.currency,
    createdAt: wallet.createdAt.toISOString(),
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

function toTransactionResponse(entry: LedgerEntry) {
  return {
    id: entry.id,
    type: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: entry.balanceAfterCents,
    settlementId: entry.settlementId,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function createWalletController(walletService: WalletService) {
  const getMine: RequestHandler = async (req, res) => {
    const wallet = await walletService.getOwnWallet(getAuthUser(req).id);
    res.status(200).json(toWalletResponse(wallet));
  };

  const deposit: RequestHandler = async (req, res) => {
    const { amountCents } = depositBodySchema.parse(req.body);
    const { wallet, entry } = await walletService.deposit(getAuthUser(req).id, amountCents);
    // 200, not 201: a deposit is an action on the wallet, and a single ledger row has no URL of its
    // own that a Location header could point to. The answer carries the new balance and the row.
    res
      .status(200)
      .json({ wallet: toWalletResponse(wallet), transaction: toTransactionResponse(entry) });
  };

  const listTransactions: RequestHandler = async (req, res) => {
    const { entries, ...pagination } = await walletService.listTransactions(
      getAuthUser(req).id,
      transactionsQuerySchema.parse(req.query),
    );
    res.status(200).json({ data: entries.map(toTransactionResponse), ...pagination });
  };

  const checkFunds: RequestHandler = async (req, res) => {
    const { userId, amountCents } = fundsCheckQuerySchema.parse(req.query);
    res.status(200).json(await walletService.checkFunds(userId, amountCents));
  };

  return { getMine, deposit, listTransactions, checkFunds };
}
