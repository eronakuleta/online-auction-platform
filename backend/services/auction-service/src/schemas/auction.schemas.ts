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
