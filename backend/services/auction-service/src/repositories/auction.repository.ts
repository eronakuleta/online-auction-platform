import type { Queryable } from './database';

export type AuctionStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'CLOSED_SOLD'
  | 'CLOSED_NO_SALE'
  | 'SETTLED'
  | 'PAYMENT_FAILED';

/** "Upcoming" and "live" are never stored. They are derived from the times (ROADMAP §4). */
export type AuctionPhase = 'UPCOMING' | 'LIVE' | 'ENDED';

/** The fields a seller controls. */
export interface AuctionDetails {
  categoryId: string;
  title: string;
  description: string;
  startingPriceCents: number;
  minIncrementCents: number;
  reservePriceCents: number | null;
  startsAt: Date;
  endsAt: Date;
}

export interface Auction extends AuctionDetails {
  id: string;
  sellerId: string;
  currency: string;
  status: AuctionStatus;
  phase: AuctionPhase | null;
  /** True once ends_at has passed, by the database clock. */
  ended: boolean;
  winnerId: string | null;
  finalPriceCents: number | null;
  imageUrls: string[];
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// pg returns bigint as a string, because it can exceed what a JS number holds exactly. The API only
// accepts safe integers, so converting these back with Number() loses nothing.
interface AuctionRow {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  currency: string;
  starting_price_cents: string;
  min_increment_cents: string;
  reserve_price_cents: string | null;
  starts_at: Date;
  ends_at: Date;
  status: AuctionStatus;
  phase: AuctionPhase | null;
  ended: boolean;
  winner_id: string | null;
  final_price_cents: string | null;
  image_urls: string[];
  published_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toAuction(row: AuctionRow): Auction {
  return {
    id: row.id,
    sellerId: row.seller_id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    currency: row.currency,
    startingPriceCents: Number(row.starting_price_cents),
    minIncrementCents: Number(row.min_increment_cents),
    reservePriceCents: row.reserve_price_cents === null ? null : Number(row.reserve_price_cents),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    phase: row.phase,
    ended: row.ended,
    winnerId: row.winner_id,
    finalPriceCents: row.final_price_cents === null ? null : Number(row.final_price_cents),
    imageUrls: row.image_urls,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_AUCTION = `
  SELECT a.id, a.seller_id, a.category_id, a.title, a.description, a.currency,
         a.starting_price_cents, a.min_increment_cents, a.reserve_price_cents,
         a.starts_at, a.ends_at, a.status, a.winner_id, a.final_price_cents,
         a.published_at, a.closed_at, a.created_at, a.updated_at,
         a.ends_at <= now() AS ended,
         CASE
           WHEN a.status <> 'PUBLISHED' THEN NULL
           WHEN now() < a.starts_at THEN 'UPCOMING'
           WHEN now() < a.ends_at THEN 'LIVE'
           ELSE 'ENDED'
         END AS phase,
         COALESCE(
           (SELECT array_agg(i.url ORDER BY i.position)
            FROM auction_images i WHERE i.auction_id = a.id),
           '{}'
         ) AS image_urls
  FROM auctions a`;

export async function findAuctionById(db: Queryable, id: string): Promise<Auction | null> {
  const { rows } = await db.query<AuctionRow>(`${SELECT_AUCTION} WHERE a.id = $1`, [id]);
  return rows[0] ? toAuction(rows[0]) : null;
}

/** Locks the row until the transaction ends, so changes to one auction run one after another. */
export async function findAuctionForUpdate(db: Queryable, id: string): Promise<Auction | null> {
  const { rowCount } = await db.query('SELECT 1 FROM auctions WHERE id = $1 FOR UPDATE', [id]);
  return rowCount ? findAuctionById(db, id) : null;
}

export async function categoryExists(db: Queryable, categoryId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM categories WHERE id = $1', [categoryId]);
  return Boolean(rowCount);
}

export async function insertAuction(
  db: Queryable,
  auction: AuctionDetails & { sellerId: string; currency: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO auctions (
       seller_id, category_id, title, description, currency,
       starting_price_cents, min_increment_cents, reserve_price_cents, starts_at, ends_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      auction.sellerId,
      auction.categoryId,
      auction.title,
      auction.description,
      auction.currency,
      auction.startingPriceCents,
      auction.minIncrementCents,
      auction.reservePriceCents,
      auction.startsAt,
      auction.endsAt,
    ],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('INSERT into auctions returned no row');
  }
  return id;
}

export async function updateAuctionDetails(
  db: Queryable,
  id: string,
  details: AuctionDetails,
): Promise<void> {
  await db.query(
    `UPDATE auctions
     SET category_id = $2, title = $3, description = $4, starting_price_cents = $5,
         min_increment_cents = $6, reserve_price_cents = $7, starts_at = $8, ends_at = $9,
         updated_at = now()
     WHERE id = $1`,
    [
      id,
      details.categoryId,
      details.title,
      details.description,
      details.startingPriceCents,
      details.minIncrementCents,
      details.reservePriceCents,
      details.startsAt,
      details.endsAt,
    ],
  );
}

/** Makes the auction's images exactly this list, in this order. */
export async function replaceAuctionImages(
  db: Queryable,
  auctionId: string,
  urls: string[],
): Promise<void> {
  await db.query('DELETE FROM auction_images WHERE auction_id = $1', [auctionId]);
  await db.query(
    `INSERT INTO auction_images (auction_id, url, position)
     SELECT $1, image.url, (image.ordinal - 1)::smallint
     FROM unnest($2::text[]) WITH ORDINALITY AS image(url, ordinal)`,
    [auctionId, urls],
  );
}

export async function markAuctionPublished(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE auctions SET status = 'PUBLISHED', published_at = now(), updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function markAuctionCancelled(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE auctions SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [
    id,
  ]);
}

/** Anti-sniping only ever moves the end later, so an old, retried event can never shorten it. */
export async function extendAuctionEnd(db: Queryable, id: string, endsAt: Date): Promise<void> {
  await db.query(
    `UPDATE auctions SET ends_at = GREATEST(ends_at, $2), updated_at = now() WHERE id = $1`,
    [id, endsAt],
  );
}

export type ClosedResult =
  | { status: 'CLOSED_SOLD'; winnerId: string; finalPriceCents: number; closedAt: Date }
  | { status: 'CLOSED_NO_SALE'; closedAt: Date };

export async function markAuctionClosed(
  db: Queryable,
  id: string,
  result: ClosedResult,
): Promise<void> {
  const sold = result.status === 'CLOSED_SOLD';
  await db.query(
    `UPDATE auctions
     SET status = $2, winner_id = $3, final_price_cents = $4, closed_at = $5, updated_at = now()
     WHERE id = $1`,
    [
      id,
      result.status,
      sold ? result.winnerId : null,
      sold ? result.finalPriceCents : null,
      result.closedAt,
    ],
  );
}

export async function markAuctionPayment(
  db: Queryable,
  id: string,
  status: 'SETTLED' | 'PAYMENT_FAILED',
): Promise<void> {
  await db.query(`UPDATE auctions SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}

export async function deleteAuction(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM auctions WHERE id = $1', [id]);
}

export type AuctionSort = 'newest' | 'ending_soon' | 'price_asc' | 'price_desc' | 'relevance';

export interface AuctionListFilter {
  q?: string;
  categoryId?: string;
  status: AuctionStatus;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort: AuctionSort;
  limit: number;
  offset: number;
}

// Sort keys are chosen from this fixed map, never from user input. The id at the end keeps the
// order stable when two rows are equal, so pages never repeat or skip a row.
const ORDER_BY: Record<Exclude<AuctionSort, 'relevance'>, string> = {
  newest: 'a.published_at DESC, a.id',
  ending_soon: 'a.ends_at ASC, a.id',
  price_asc: 'a.starting_price_cents ASC, a.id',
  price_desc: 'a.starting_price_cents DESC, a.id',
};

/**
 * The public catalog. The WHERE clause is built only from fixed fragments, and every value is a
 * $n parameter, so user input never becomes part of the SQL text. Building it per request (instead
 * of "$1 IS NULL OR ...") lets Postgres use the indexes for the filters that are actually set.
 */
export async function listAuctions(
  db: Queryable,
  filter: AuctionListFilter,
): Promise<{ auctions: Auction[]; total: number }> {
  const values: unknown[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return '$' + values.length;
  };

  // A never-published auction (a draft, or a draft that was cancelled) is never in the catalog.
  const conditions = ['a.published_at IS NOT NULL', 'a.status = ' + param(filter.status)];
  let query: string | undefined;
  if (filter.q !== undefined) {
    // websearch_to_tsquery understands "quotes", OR and -minus, and never fails on odd input.
    query = "websearch_to_tsquery('english', " + param(filter.q) + ')';
    conditions.push('a.search_vector @@ ' + query);
  }
  if (filter.categoryId !== undefined) {
    conditions.push('a.category_id = ' + param(filter.categoryId));
  }
  if (filter.minPriceCents !== undefined) {
    conditions.push('a.starting_price_cents >= ' + param(filter.minPriceCents));
  }
  if (filter.maxPriceCents !== undefined) {
    conditions.push('a.starting_price_cents <= ' + param(filter.maxPriceCents));
  }
  const where = conditions.join(' AND ');
  const filterValues = [...values];

  const orderBy =
    filter.sort === 'relevance' && query !== undefined
      ? 'ts_rank_cd(a.search_vector, ' + query + ') DESC, a.id'
      : ORDER_BY[filter.sort === 'relevance' ? 'newest' : filter.sort];

  const { rows } = await db.query<AuctionRow>(
    SELECT_AUCTION +
      ' WHERE ' +
      where +
      ' ORDER BY ' +
      orderBy +
      ' LIMIT ' +
      param(filter.limit) +
      ' OFFSET ' +
      param(filter.offset),
    values,
  );
  const count = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM auctions a WHERE ' + where,
    filterValues,
  );
  return { auctions: rows.map(toAuction), total: Number(count.rows[0]?.total ?? 0) };
}

/**
 * One seller's own auctions in every state, drafts included, newest first (the seller dashboard).
 * Uses the auctions_seller_id_idx index. The id breaks ties, so paging never repeats a row.
 */
export async function listSellerAuctions(
  db: Queryable,
  sellerId: string,
  filter: { status?: AuctionStatus; limit: number; offset: number },
): Promise<{ auctions: Auction[]; total: number }> {
  const filterValues: unknown[] = [sellerId];
  let where = 'a.seller_id = $1';
  if (filter.status !== undefined) {
    filterValues.push(filter.status);
    where += ' AND a.status = $2';
  }
  const limitParam = '$' + (filterValues.length + 1);
  const offsetParam = '$' + (filterValues.length + 2);
  const { rows } = await db.query<AuctionRow>(
    SELECT_AUCTION +
      ' WHERE ' +
      where +
      ' ORDER BY a.created_at DESC, a.id LIMIT ' +
      limitParam +
      ' OFFSET ' +
      offsetParam,
    [...filterValues, filter.limit, filter.offset],
  );
  const count = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM auctions a WHERE ' + where,
    filterValues,
  );
  return { auctions: rows.map(toAuction), total: Number(count.rows[0]?.total ?? 0) };
}
