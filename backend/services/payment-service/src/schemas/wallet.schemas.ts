// Request validation. Strict objects reject unknown fields, so a client can never choose a wallet,
// a currency or a ledger type.
import { z } from 'zod';

/** Decision Q12: one simulated deposit is 1 cent to 10,000.00. */
export const MAX_DEPOSIT_CENTS = 1_000_000;

export const depositBodySchema = z.strictObject({
  // z.int() accepts only whole numbers, so money never becomes a float.
  amountCents: z.int().min(1).max(MAX_DEPOSIT_CENTS),
});

export const transactionsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /internal/funds-check (decision Q10). Query values arrive as strings. */
export const fundsCheckQuerySchema = z.strictObject({
  userId: z.uuid(),
  amountCents: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
