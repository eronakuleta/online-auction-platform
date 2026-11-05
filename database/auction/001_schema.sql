-- auction_db schema (auction-service, owner: Erona, task A-10).
-- Runs once, connected to auction_db, on a fresh Postgres volume (database/init-databases.sh).
-- The catalog and lifecycle of auctions. Live bidding state (highest bid, extensions) lives in
-- bidding_db; this database learns results through events (auction.extended, auction.closed,
-- payment.*). seller_id and winner_id are user IDs from auth_db, so they have no foreign key:
-- one database per service, no cross-database references.
-- The watchlist table is stretch (ROADMAP §2) and comes in a later numbered file if built.

BEGIN;

CREATE TABLE categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_length CHECK (length(btrim(name)) BETWEEN 2 AND 60)
);

-- "Art" and "art" are the same category.
CREATE UNIQUE INDEX categories_name_unique ON categories (lower(name));

CREATE TABLE auctions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id            uuid        NOT NULL,
  category_id          uuid        NOT NULL REFERENCES categories (id),
  title                text        NOT NULL,
  description          text        NOT NULL DEFAULT '',
  -- Money is integer cents plus an ISO 4217 currency code; never floats.
  currency             char(3)     NOT NULL,
  starting_price_cents bigint      NOT NULL,
  min_increment_cents  bigint      NOT NULL,
  reserve_price_cents  bigint,
  starts_at            timestamptz NOT NULL,
  -- Moves later when bidding-service applies anti-sniping (auction.extended).
  ends_at              timestamptz NOT NULL,
  status               text        NOT NULL DEFAULT 'DRAFT',
  -- Filled from auction.closed when the auction is sold.
  winner_id            uuid,
  final_price_cents    bigint,
  published_at         timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Full-text search for GET /auctions?q=... (FR-05), kept up to date by Postgres itself.
  search_vector        tsvector GENERATED ALWAYS AS (
                         to_tsvector('english', title || ' ' || description)
                       ) STORED,

  CONSTRAINT auctions_title_length CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  CONSTRAINT auctions_description_length CHECK (length(description) <= 5000),
  CONSTRAINT auctions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT auctions_starting_price_positive CHECK (starting_price_cents > 0),
  CONSTRAINT auctions_min_increment_positive CHECK (min_increment_cents > 0),
  CONSTRAINT auctions_reserve_positive CHECK (reserve_price_cents IS NULL OR reserve_price_cents > 0),
  CONSTRAINT auctions_ends_after_start CHECK (ends_at > starts_at),
  CONSTRAINT auctions_status_known CHECK (status IN (
    'DRAFT', 'PUBLISHED', 'CANCELLED', 'CLOSED_SOLD', 'CLOSED_NO_SALE', 'SETTLED', 'PAYMENT_FAILED'
  )),
  -- A sold auction always has a winner and a price; any other auction never has one.
  CONSTRAINT auctions_result_matches_status CHECK (
    CASE
      WHEN status IN ('CLOSED_SOLD', 'SETTLED', 'PAYMENT_FAILED')
        THEN winner_id IS NOT NULL AND final_price_cents IS NOT NULL
      ELSE winner_id IS NULL AND final_price_cents IS NULL
    END
  ),
  CONSTRAINT auctions_final_price_positive CHECK (final_price_cents IS NULL OR final_price_cents > 0),
  CONSTRAINT auctions_seller_cannot_win CHECK (winner_id IS NULL OR winner_id <> seller_id),
  -- Every state after DRAFT has been published; drafts have not.
  CONSTRAINT auctions_published_at_matches_status CHECK (
    (status = 'DRAFT') = (published_at IS NULL) OR status = 'CANCELLED'
  ),
  CONSTRAINT auctions_closed_at_matches_status CHECK (
    (status IN ('CLOSED_SOLD', 'CLOSED_NO_SALE', 'SETTLED', 'PAYMENT_FAILED')) = (closed_at IS NOT NULL)
  ),
  CONSTRAINT auctions_updated_after_created CHECK (updated_at >= created_at)
);

-- Catalog filters and sorting (FR-05): by status and end time, category, seller, price.
CREATE INDEX auctions_status_ends_at_idx ON auctions (status, ends_at);
CREATE INDEX auctions_category_id_idx ON auctions (category_id);
CREATE INDEX auctions_seller_id_idx ON auctions (seller_id);
CREATE INDEX auctions_starting_price_idx ON auctions (starting_price_cents);
CREATE INDEX auctions_created_at_idx ON auctions (created_at);
CREATE INDEX auctions_search_vector_idx ON auctions USING gin (search_vector);

-- Images are referenced by URL only; there is no file upload (requirements §6).
CREATE TABLE auction_images (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id uuid        NOT NULL REFERENCES auctions (id) ON DELETE CASCADE,
  url        text        NOT NULL,
  position   smallint    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_images_url_format CHECK (url ~ '^https?://[^\s]+$' AND length(url) <= 2048),
  CONSTRAINT auction_images_position_range CHECK (position BETWEEN 0 AND 9),
  CONSTRAINT auction_images_position_unique UNIQUE (auction_id, position)
);

-- Event consumers must be idempotent (CLAUDE.md): an event ID is recorded in the same
-- transaction as its effect, so a redelivered event is skipped (task A-13).
CREATE TABLE processed_events (
  event_id     uuid        PRIMARY KEY,
  event_type   text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
