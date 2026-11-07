// Request validation. Strict objects reject unknown fields, so a client can never choose the
// bidder, the time or the sequence of a bid.
import { z } from 'zod';

export const auctionIdParamsSchema = z.strictObject({ id: z.uuid() });

// z.int() accepts only safe integers, so money never becomes a float or loses precision.
export const placeBidBodySchema = z.strictObject({ amountCents: z.int().positive() });

export const internalCancelBodySchema = z.strictObject({
  cancelledBy: z.uuid(),
  isAdmin: z.boolean(),
});
