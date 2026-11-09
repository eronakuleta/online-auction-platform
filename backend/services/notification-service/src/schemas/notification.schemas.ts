// Request validation. Strict objects reject unknown fields and query parameters.
import { z } from 'zod';

export const notificationIdParamsSchema = z.strictObject({ id: z.uuid() });

// Pagination as in docs/events.md §9: page from 1, size 1 to 100, anything else is a 400.
export const paginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
