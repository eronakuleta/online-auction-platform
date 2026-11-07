// Request validation. Strict objects reject unknown fields, so a client can never choose the
// bidder, the time or the sequence of a bid.
import { z } from 'zod';

export const auctionIdParamsSchema = z.strictObject({ id: z.uuid() });

// z.int() accepts only safe integers, so money never becomes a float or loses precision.
export const placeBidBodySchema = z.strictObject({ amountCents: z.int().positive() });

// Optional. Letters, digits, - and _ only, as the idempotency_keys table allows (B-10).
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,255}$/, 'Idempotency-Key must be 1-255 letters, digits, - or _')
  .optional();

// Pagination as in docs/events.md §9: page from 1, size 1 to 100, anything else is a 400.
export const paginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export const internalCancelBodySchema = z.strictObject({
  cancelledBy: z.uuid(),
  isAdmin: z.boolean(),
});
