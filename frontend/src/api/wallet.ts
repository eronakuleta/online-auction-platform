// payment-service wallet endpoints (docs/requirements.md FR-11, decisions Q11 to Q13).
import { apiClient } from './client';
import type { Page } from './types';

export interface Wallet {
  id: string;
  userId: string;
  balanceCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export type TransactionType = 'DEPOSIT' | 'SETTLEMENT_DEBIT' | 'SETTLEMENT_CREDIT' | 'PLATFORM_FEE';

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Signed: positive adds money, negative takes it out. */
  amountCents: number;
  balanceAfterCents: number;
  settlementId: string | null;
  createdAt: string;
}

/** Decision Q12: one simulated deposit is 1 cent to 10,000.00. The server checks it again. */
export const MAX_DEPOSIT_CENTS = 1_000_000;

export const walletApi = {
  mine: (signal?: AbortSignal) => apiClient.get<Wallet>('/wallet/me', { signal }),
  deposit: (amountCents: number) =>
    apiClient.post<{ wallet: Wallet; transaction: Transaction }>('/wallet/deposit', {
      amountCents,
    }),
  transactions: (page: number, size: number, signal?: AbortSignal) =>
    apiClient.get<Page<Transaction>>(`/wallet/transactions?page=${page}&size=${size}`, {
      signal,
    }),
};
