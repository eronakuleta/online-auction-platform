// The only place with SQL for bidding_db (database/bidding/001_schema.sql). Every query is
// parameterized. Functions that take a Queryable run inside the caller's transaction.
import type { Queryable } from './database';

export type AuctionStatus = 'OPEN' | 'CANCELLED' | 'CLOSED_SOLD' | 'CLOSED_NO_SALE';

/** A complete snapshot. Placeholder rows (cancelled before published) have no prices. */
export interface AuctionState {
  auctionId: string;
  sellerId: string;
  title: string;
  status: AuctionStatus;
  currency: string | null;
  startingPriceCents: number | null;
  minIncrementCents: number | null;
  reservePriceCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  originalEndsAt: Date | null;
  extensionCount: number;
  highestBidId: string | null;
  highestBidCents: number | null;
  highestBidderId: string | null;
  bidCount: number;
  version: number;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  amountCents: number;
  sequence: number;
  placedAt: Date;
}

interface AuctionStateRow {
  auction_id: string;
  seller_id: string;
  title: string;
  status: AuctionStatus;
  currency: string | null;
  starting_price_cents: string | null;
  min_increment_cents: string | null;
  reserve_price_cents: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  original_ends_at: Date | null;
  extension_count: number;
  highest_bid_id: string | null;
  highest_bid_cents: string | null;
  highest_bidder_id: string | null;
  bid_count: number;
  version: string;
}

interface BidRow {
  id: string;
  auction_id: string;
  bidder_id: string;
  amount_cents: string;
  sequence: number;
  placed_at: Date;
}

// pg returns bigint as a string. Money is checked to be a safe integer before it is stored, so
// converting it back with Number() loses nothing.
const toNumber = (value: string | null) => (value === null ? null : Number(value));

function toAuctionState(row: AuctionStateRow): AuctionState {
  return {
    auctionId: row.auction_id,
    sellerId: row.seller_id,
    title: row.title,
    status: row.status,
    currency: row.currency,
    startingPriceCents: toNumber(row.starting_price_cents),
    minIncrementCents: toNumber(row.min_increment_cents),
    reservePriceCents: toNumber(row.reserve_price_cents),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    originalEndsAt: row.original_ends_at,
    extensionCount: row.extension_count,
    highestBidId: row.highest_bid_id,
    highestBidCents: toNumber(row.highest_bid_cents),
    highestBidderId: row.highest_bidder_id,
    bidCount: row.bid_count,
    version: Number(row.version),
  };
}

function toBid(row: BidRow): Bid {
  return {
    id: row.id,
    auctionId: row.auction_id,
    bidderId: row.bidder_id,
    amountCents: Number(row.amount_cents),
    sequence: row.sequence,
    placedAt: row.placed_at,
  };
}

const STATE_COLUMNS = `auction_id, seller_id, title, status, currency, starting_price_cents,
  min_increment_cents, reserve_price_cents, starts_at, ends_at, original_ends_at, extension_count,
  highest_bid_id, highest_bid_cents, highest_bidder_id, bid_count, version`;

/**
 * Locks the auction row until the transaction ends. place-bid, the internal cancel call and the
 * closing worker all start here, so they can never change the same auction at the same time.
 */
export async function lockAuctionState(
  tx: Queryable,
  auctionId: string,
): Promise<AuctionState | null> {
  const result = await tx.query<AuctionStateRow>(
    `SELECT ${STATE_COLUMNS} FROM auction_state WHERE auction_id = $1 FOR UPDATE`,
    [auctionId],
  );
  return result.rows[0] === undefined ? null : toAuctionState(result.rows[0]);
}

/**
 * The real current time. now() is fixed when the transaction starts, which can be long before
 * the row lock was granted, so time rules use clock_timestamp() read after locking.
 * Postgres is the only clock, because two replicas may run (docs/events.md §10).
 */
export async function currentTime(tx: Queryable): Promise<Date> {
  const result = await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0]!.now;
}

export async function insertBid(
  tx: Queryable,
  bid: {
    auctionId: string;
    bidderId: string;
    amountCents: number;
    sequence: number;
    placedAt: Date;
  },
): Promise<Bid> {
  const result = await tx.query<BidRow>(
    `INSERT INTO bids (auction_id, bidder_id, amount_cents, sequence, placed_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, auction_id, bidder_id, amount_cents, sequence, placed_at`,
    [bid.auctionId, bid.bidderId, bid.amountCents, bid.sequence, bid.placedAt],
  );
  return toBid(result.rows[0]!);
}

/**
 * Makes the new bid the highest one and, for anti-sniping, moves the end later by extendBySeconds
 * (0 = no extension). Postgres does the date arithmetic: it stores microseconds while a JS Date
 * keeps milliseconds, so writing ends_at back from JS could move it slightly earlier.
 * Only call it while holding the row lock.
 */
export async function recordHighestBid(
  tx: Queryable,
  auctionId: string,
  bid: Bid,
  timing: { extendBySeconds: number; updatedAt: Date },
): Promise<AuctionState> {
  const result = await tx.query<AuctionStateRow>(
    `UPDATE auction_state
     SET highest_bid_id = $2, highest_bid_cents = $3, highest_bidder_id = $4,
         bid_count = $5,
         ends_at = ends_at + make_interval(secs => $6),
         extension_count = extension_count + CASE WHEN $6 > 0 THEN 1 ELSE 0 END,
         version = version + 1, updated_at = $7
     WHERE auction_id = $1
     RETURNING ${STATE_COLUMNS}`,
    [
      auctionId,
      bid.id,
      bid.amountCents,
      bid.bidderId,
      bid.sequence,
      timing.extendBySeconds,
      timing.updatedAt,
    ],
  );
  return toAuctionState(result.rows[0]!);
}

export async function markCancelled(
  tx: Queryable,
  auctionId: string,
  cancelledBy: string,
  cancelledAt: Date,
): Promise<void> {
  await tx.query(
    `UPDATE auction_state
     SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = $3,
         version = version + 1, updated_at = $3
     WHERE auction_id = $1`,
    [auctionId, cancelledBy, cancelledAt],
  );
}
