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

/**
 * Locks up to `limit` open auctions whose end time has passed (B-11). SKIP LOCKED passes over rows
 * that another transaction holds, so two replicas never close the same auction, and a closing
 * worker never waits behind a bid in progress: it simply takes that auction on its next round.
 * now() is the start of this transaction, which is the moment the worker looked (docs/events.md §10).
 */
export async function lockExpiredAuctions(tx: Queryable, limit: number): Promise<AuctionState[]> {
  const result = await tx.query<AuctionStateRow>(
    `SELECT ${STATE_COLUMNS} FROM auction_state
     WHERE status = 'OPEN' AND ends_at <= now()
     ORDER BY ends_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows.map(toAuctionState);
}

/** Everyone who bid on the auction, each once. */
export async function listBidderIds(tx: Queryable, auctionId: string): Promise<string[]> {
  const result = await tx.query<{ bidder_id: string }>(
    'SELECT DISTINCT bidder_id FROM bids WHERE auction_id = $1 ORDER BY bidder_id',
    [auctionId],
  );
  return result.rows.map((row) => row.bidder_id);
}

/** Stores the result. Only call it while holding the row lock. Returns the closing time. */
export async function markClosed(
  tx: Queryable,
  auctionId: string,
  status: 'CLOSED_SOLD' | 'CLOSED_NO_SALE',
): Promise<Date> {
  const result = await tx.query<{ closed_at: Date }>(
    `UPDATE auction_state
     SET status = $2, closed_at = now(), version = version + 1, updated_at = now()
     WHERE auction_id = $1
     RETURNING closed_at`,
    [auctionId, status],
  );
  return result.rows[0]!.closed_at;
}

/**
 * Records that an event was handled, in the same transaction as its effect (docs/events.md §7).
 * Returns false if it was already recorded, so a redelivered event is skipped.
 */
export async function markEventProcessed(
  tx: Queryable,
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType],
  );
  return result.rowCount === 1;
}

/**
 * Stores the snapshot from auction.published. ON CONFLICT DO NOTHING: a row that already exists,
 * including a CANCELLED placeholder from an earlier auction.cancelled, is never reopened.
 * Returns false if the row already existed.
 */
export async function insertSnapshot(
  tx: Queryable,
  snapshot: {
    auctionId: string;
    sellerId: string;
    title: string;
    currency: string;
    startingPriceCents: number;
    minIncrementCents: number;
    reservePriceCents: number | null;
    startsAt: string;
    endsAt: string;
  },
): Promise<boolean> {
  const result = await tx.query(
    `INSERT INTO auction_state (auction_id, seller_id, title, currency, starting_price_cents,
       min_increment_cents, reserve_price_cents, starts_at, ends_at, original_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (auction_id) DO NOTHING`,
    [
      snapshot.auctionId,
      snapshot.sellerId,
      snapshot.title,
      snapshot.currency,
      snapshot.startingPriceCents,
      snapshot.minIncrementCents,
      snapshot.reservePriceCents,
      snapshot.startsAt,
      snapshot.endsAt,
    ],
  );
  return result.rowCount === 1;
}

/**
 * Applies auction.cancelled. An unknown auction gets a CANCELLED placeholder, so a late
 * auction.published cannot open it (docs/events.md §7). An open auction is cancelled; one that is
 * already cancelled or closed is left as it is. Returns the resulting status.
 */
export async function cancelFromEvent(
  tx: Queryable,
  cancel: { auctionId: string; sellerId: string; title: string; cancelledBy: string },
): Promise<string> {
  await tx.query(
    `INSERT INTO auction_state (auction_id, seller_id, title, status, cancelled_by, cancelled_at)
     VALUES ($1, $2, $3, 'CANCELLED', $4, now())
     ON CONFLICT (auction_id) DO UPDATE
       SET status = 'CANCELLED', cancelled_by = EXCLUDED.cancelled_by, cancelled_at = now(),
           version = auction_state.version + 1, updated_at = now()
       WHERE auction_state.status = 'OPEN'`,
    [cancel.auctionId, cancel.sellerId, cancel.title, cancel.cancelledBy],
  );
  const result = await tx.query<{ status: string }>(
    'SELECT status FROM auction_state WHERE auction_id = $1',
    [cancel.auctionId],
  );
  return result.rows[0]!.status;
}

/** Reads the auction without locking it, for the public read endpoints (B-08). */
export async function findAuctionState(
  db: Queryable,
  auctionId: string,
): Promise<AuctionState | null> {
  const result = await db.query<AuctionStateRow>(
    `SELECT ${STATE_COLUMNS} FROM auction_state WHERE auction_id = $1`,
    [auctionId],
  );
  return result.rows[0] === undefined ? null : toAuctionState(result.rows[0]);
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** An auction's bids, newest first. The unique (auction_id, sequence) index serves this query. */
export async function listBidsOfAuction(
  db: Queryable,
  auctionId: string,
  limit: number,
  offset: number,
): Promise<Page<Bid>> {
  const [rows, count] = await Promise.all([
    db.query<BidRow>(
      `SELECT id, auction_id, bidder_id, amount_cents, sequence, placed_at FROM bids
       WHERE auction_id = $1 ORDER BY sequence DESC LIMIT $2 OFFSET $3`,
      [auctionId, limit, offset],
    ),
    db.query<{ total: number }>('SELECT count(*)::int AS total FROM bids WHERE auction_id = $1', [
      auctionId,
    ]),
  ]);
  return { items: rows.rows.map(toBid), total: count.rows[0]!.total };
}

export interface MyBid extends Bid {
  title: string;
  currency: string;
  auctionStatus: AuctionStatus;
  endsAt: Date;
  /** This bid is the auction's current highest bid (or the winning one once closed). */
  isHighest: boolean;
}

/** A user's bids across all auctions, newest first (GET /bids/me). */
export async function listBidsOfBidder(
  db: Queryable,
  bidderId: string,
  limit: number,
  offset: number,
): Promise<Page<MyBid>> {
  const [rows, count] = await Promise.all([
    db.query<
      BidRow & {
        title: string;
        currency: string;
        status: AuctionStatus;
        ends_at: Date;
        is_highest: boolean;
      }
    >(
      `SELECT b.id, b.auction_id, b.bidder_id, b.amount_cents, b.sequence, b.placed_at,
         s.title, s.currency, s.status, s.ends_at, (s.highest_bid_id = b.id) AS is_highest
       FROM bids b JOIN auction_state s ON s.auction_id = b.auction_id
       WHERE b.bidder_id = $1
       ORDER BY b.placed_at DESC, b.id
       LIMIT $2 OFFSET $3`,
      [bidderId, limit, offset],
    ),
    db.query<{ total: number }>('SELECT count(*)::int AS total FROM bids WHERE bidder_id = $1', [
      bidderId,
    ]),
  ]);
  return {
    items: rows.rows.map((row) => ({
      ...toBid(row),
      title: row.title,
      currency: row.currency,
      auctionStatus: row.status,
      endsAt: row.ends_at,
      isHighest: row.is_highest,
    })),
    total: count.rows[0]!.total,
  };
}
