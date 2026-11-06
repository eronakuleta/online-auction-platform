// Request validation. Strict objects reject unknown fields, so a client can never set status,
// sellerId or currency. Limits match the CHECK constraints in database/auction/001_schema.sql.
import { z } from 'zod';

// Postgres text cannot hold a NUL character, so it would otherwise surface as a 500.
const withoutNul = (value: string) => !value.includes('\0');

const title = z.string().trim().min(3).max(120).refine(withoutNul, 'Invalid character');
const description = z.string().max(5000).refine(withoutNul, 'Invalid character');
// z.int() accepts only safe integers, so money never becomes a float or loses precision.
const cents = z.int().positive();
const timestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .pipe(z.date());
const imageUrls = z
  .array(
    z
      .string()
      .max(2048)
      .regex(/^https?:\/\/\S+$/, 'Must be an http or https URL')
      .refine(withoutNul, 'Invalid character'),
  )
  .max(10);

export const auctionIdParamsSchema = z.strictObject({ id: z.uuid() });

// GET /auctions/mine: the seller's own auctions, so every status is allowed, DRAFT included.
export const listMyAuctionsQuerySchema = z.strictObject({
  status: z
    .enum([
      'DRAFT',
      'PUBLISHED',
      'CANCELLED',
      'CLOSED_SOLD',
      'CLOSED_NO_SALE',
      'SETTLED',
      'PAYMENT_FAILED',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export const createAuctionBodySchema = z.strictObject({
  categoryId: z.uuid(),
  title,
  description: description.default(''),
  startingPriceCents: cents,
  minIncrementCents: cents,
  reservePriceCents: cents.nullable().default(null),
  startsAt: timestamp,
  endsAt: timestamp,
  imageUrls: imageUrls.default([]),
});

export const updateAuctionBodySchema = z
  .strictObject({
    categoryId: z.uuid(),
    title,
    description,
    startingPriceCents: cents,
    minIncrementCents: cents,
    reservePriceCents: cents.nullable(),
    startsAt: timestamp,
    endsAt: timestamp,
    imageUrls,
  })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'At least one field is required');

const queryCents = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// GET /auctions. Values outside the limits are a 400 (docs/events.md section 9). A draft is never in
// the catalog, so DRAFT is not a valid status here.
export const listAuctionsQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1).max(100).refine(withoutNul, 'Invalid character').optional(),
    categoryId: z.uuid().optional(),
    status: z
      .enum([
        'PUBLISHED',
        'CANCELLED',
        'CLOSED_SOLD',
        'CLOSED_NO_SALE',
        'SETTLED',
        'PAYMENT_FAILED',
      ])
      .default('PUBLISHED'),
    minPriceCents: queryCents.optional(),
    maxPriceCents: queryCents.optional(),
    sort: z.enum(['newest', 'ending_soon', 'price_asc', 'price_desc', 'relevance']).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (query) =>
      query.minPriceCents === undefined ||
      query.maxPriceCents === undefined ||
      query.minPriceCents <= query.maxPriceCents,
    { path: ['maxPriceCents'], message: 'Must not be lower than minPriceCents' },
  )
  .refine((query) => query.sort !== 'relevance' || query.q !== undefined, {
    path: ['sort'],
    message: 'Sorting by relevance needs a search term (q)',
  });
