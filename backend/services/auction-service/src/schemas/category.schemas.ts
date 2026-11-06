// Request validation for categories. The name limits match the CHECK constraint
// categories_name_length in database/auction/001_schema.sql (2 to 60 characters after trimming).
import { z } from 'zod';

export const createCategoryBodySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    // Postgres text cannot hold a NUL character, so it would otherwise surface as a 500.
    .refine((value) => !value.includes('\0'), 'Invalid character'),
});

export const categoryIdParamsSchema = z.strictObject({ id: z.uuid() });

// There are only a handful of categories, so the default page holds all of them: the create-auction
// form fills its list in one call. The standard limit of 100 still applies.
export const listCategoriesQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(100),
});
