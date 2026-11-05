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

export async function deleteAuction(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM auctions WHERE id = $1', [id]);
}
