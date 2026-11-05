import { z } from 'zod';

// The event contract from docs/events.md, as code. A change here needs both members' agreement
// and the same change in that document.

const id = z.uuid();
const timestamp = z.iso.datetime();
const cents = z.int().positive();
const currency = z.string().regex(/^[A-Z]{3}$/);
const title = z.string().min(1);

const userRegistered = z.object({
  userId: id,
  displayName: z.string().min(1),
});

const auctionPublished = z.object({
  auctionId: id,
  sellerId: id,
  title,
  startsAt: timestamp,
  endsAt: timestamp,
  startingPriceCents: cents,
  minIncrementCents: cents,
  reservePriceCents: cents.nullable(),
  currency,
});

const auctionCancelled = z.object({
  auctionId: id,
  sellerId: id,
  title,
  cancelledBy: id,
});

const bidPlaced = z.object({
  bidId: id,
  auctionId: id,
  title,
  bidderId: id,
  amountCents: cents,
  currency,
  previousHighestBidderId: id.nullable(),
  placedAt: timestamp,
});

const auctionExtended = z.object({
  auctionId: id,
  endsAt: timestamp,
  extensionCount: z.int().positive(),
});

const auctionClosedBase = {
  auctionId: id,
  sellerId: id,
  title,
  currency,
  closedAt: timestamp,
  losingBidderIds: z.array(id),
};

const auctionClosed = z.discriminatedUnion('result', [
  z.object({
    ...auctionClosedBase,
    result: z.literal('SOLD'),
    winnerId: id,
    amountCents: cents,
  }),
  z.object({
    ...auctionClosedBase,
    result: z.literal('NO_SALE'),
    noSaleReason: z.enum(['NO_BIDS', 'RESERVE_NOT_MET']),
  }),
]);

const paymentCompleted = z.object({
  settlementId: id,
  auctionId: id,
  title,
  winnerId: id,
  sellerId: id,
  amountCents: cents,
  feeCents: z.int().nonnegative(),
  sellerCents: z.int().nonnegative(),
  currency,
  settledAt: timestamp,
});

const paymentFailed = z.object({
  auctionId: id,
  title,
  winnerId: id,
  sellerId: id,
  amountCents: cents,
  currency,
  reason: z.enum(['INSUFFICIENT_FUNDS', 'WALLET_NOT_FOUND']),
  failedAt: timestamp,
});

/** Routing key to current version and payload schema. */
export const EVENT_CATALOG = {
  'user.registered': { version: 1, schema: userRegistered },
  'auction.published': { version: 1, schema: auctionPublished },
  'auction.cancelled': { version: 1, schema: auctionCancelled },
  'bid.placed': { version: 1, schema: bidPlaced },
  'auction.extended': { version: 1, schema: auctionExtended },
  'auction.closed': { version: 1, schema: auctionClosed },
  'payment.completed': { version: 1, schema: paymentCompleted },
  'payment.failed': { version: 1, schema: paymentFailed },
} as const;

export type EventType = keyof typeof EVENT_CATALOG;
export type EventPayload<T extends EventType> = z.output<(typeof EVENT_CATALOG)[T]['schema']>;

/** The message body of an event. With no type argument, it is the union of every event. */
export type DomainEvent<T extends EventType = EventType> = {
  [K in T]: {
    eventId: string;
    type: K;
    version: number;
    occurredAt: string;
    payload: EventPayload<K>;
  };
}[T];

export const envelopeSchema = z.object({
  eventId: id,
  type: z.string(),
  version: z.int().positive(),
  occurredAt: timestamp,
  payload: z.unknown(),
});
