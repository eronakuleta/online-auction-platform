-- bidding_db schema (bidding-service, owner: Anesa, task B-04).
-- Runs once, connected to bidding_db, on a fresh Postgres volume (database/init-databases.sh).
-- The live side of an auction: who is winning, the current end time and every bid. The catalog
-- (title, description, images, DRAFT state) stays in auction_db; this database gets the fields it
-- needs from auction.published and auction.cancelled (docs/events.md). seller_id and bidder_id
-- are user IDs from auth_db, so they have no foreign key: one database per service.
-- Money is integer cents, never floats. Time checks use Postgres now() (docs/events.md §10).

BEGIN;

-- One row per auction that bidding-service knows about. place-bid, the closing worker and the
-- internal cancel call all lock this row with SELECT ... FOR UPDATE, so they never overlap.
CREATE TABLE auction_state (
  auction_id           uuid        PRIMARY KEY,
  seller_id            uuid        NOT NULL,
  title                text        NOT NULL,
  -- Snapshot from auction.published. NULL only in a placeholder row (see the snapshot check).
  currency             char(3),
  starting_price_cents bigint,
  min_increment_cents  bigint,
  reserve_price_cents  bigint,
  starts_at            timestamptz,
  -- ends_at moves forward with anti-sniping; original_ends_at keeps the published end time.
  ends_at              timestamptz,
  original_ends_at     timestamptz,
  extension_count      integer     NOT NULL DEFAULT 0,
  status               text        NOT NULL DEFAULT 'OPEN',
  -- The current highest bid, copied here so place-bid reads one locked row instead of
  -- scanning bids. A foreign key below keeps the copy equal to the real bid row.
  highest_bid_id       uuid,
  highest_bid_cents    bigint,
  highest_bidder_id    uuid,
  bid_count            integer     NOT NULL DEFAULT 0,
  -- Raised by one on every change. Lets the cache and SSE drop stale updates (B-09, B-12).
  version              bigint      NOT NULL DEFAULT 0,
  cancelled_by         uuid,
  cancelled_at         timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auction_state_status_known CHECK (status IN (
    'OPEN', 'CANCELLED', 'CLOSED_SOLD', 'CLOSED_NO_SALE'
  )),
  -- auction.cancelled can arrive before auction.published (docs/events.md §7). Then only the
  -- cancel payload is known, so a CANCELLED placeholder without bids may leave the snapshot empty.
  -- The later auction.published is inserted with ON CONFLICT DO NOTHING and cannot reopen it.
  CONSTRAINT auction_state_snapshot_complete CHECK (
    (currency IS NOT NULL AND starting_price_cents IS NOT NULL AND min_increment_cents IS NOT NULL
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND original_ends_at IS NOT NULL)
    OR (status = 'CANCELLED' AND bid_count = 0)
  ),
  CONSTRAINT auction_state_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT auction_state_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT auction_state_starting_price_positive CHECK (starting_price_cents > 0),
  CONSTRAINT auction_state_min_increment_positive CHECK (min_increment_cents > 0),
  CONSTRAINT auction_state_reserve_positive CHECK (reserve_price_cents > 0),
  CONSTRAINT auction_state_ends_after_start CHECK (ends_at > starts_at),
  -- Anti-sniping only ever moves the end time later (docs/events.md §7).
  CONSTRAINT auction_state_ends_not_before_original CHECK (ends_at >= original_ends_at),
  -- The upper limit is MAX_EXTENSIONS, an env var, so the service enforces it (B-07).
  CONSTRAINT auction_state_extension_count_valid CHECK (
    extension_count >= 0 AND (extension_count = 0 OR ends_at > original_ends_at)
  ),
  -- Either there is no bid yet, or all four highest-bid fields are set.
  CONSTRAINT auction_state_highest_bid_complete CHECK (
    (bid_count = 0 AND highest_bid_id IS NULL AND highest_bid_cents IS NULL
      AND highest_bidder_id IS NULL)
    OR (bid_count > 0 AND highest_bid_id IS NOT NULL AND highest_bid_cents IS NOT NULL
      AND highest_bidder_id IS NOT NULL)
  ),
  CONSTRAINT auction_state_highest_at_least_start CHECK (highest_bid_cents >= starting_price_cents),
  CONSTRAINT auction_state_seller_not_highest CHECK (highest_bidder_id <> seller_id),
  CONSTRAINT auction_state_version_not_negative CHECK (version >= 0),
  CONSTRAINT auction_state_cancel_fields_match_status CHECK (
    (status = 'CANCELLED') = (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT auction_state_closed_at_matches_status CHECK (
    (status IN ('CLOSED_SOLD', 'CLOSED_NO_SALE')) = (closed_at IS NOT NULL)
  ),
  -- Sold means a bid exists and the reserve (if any) was met; no sale means the opposite.
  CONSTRAINT auction_state_result_matches_reserve CHECK (
    CASE status
      WHEN 'CLOSED_SOLD' THEN highest_bid_cents IS NOT NULL
        AND (reserve_price_cents IS NULL OR highest_bid_cents >= reserve_price_cents)
      WHEN 'CLOSED_NO_SALE' THEN highest_bid_cents IS NULL
        OR (reserve_price_cents IS NOT NULL AND highest_bid_cents < reserve_price_cents)
      ELSE true
    END
  ),
  CONSTRAINT auction_state_updated_after_created CHECK (updated_at >= created_at)
);

-- Closing worker (B-11): WHERE status = 'OPEN' AND ends_at <= now() ... FOR UPDATE SKIP LOCKED.
-- Partial, so the index stays small as closed auctions pile up.
CREATE INDEX auction_state_open_ends_at_idx ON auction_state (ends_at) WHERE status = 'OPEN';

-- Every accepted bid. Rejected bids are only logged, never stored.
CREATE TABLE bids (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id   uuid        NOT NULL REFERENCES auction_state (auction_id),
  bidder_id    uuid        NOT NULL,
  amount_cents bigint      NOT NULL,
  -- 1, 2, 3 ... per auction, assigned under the row lock as bid_count + 1. Gives one clear bid
  -- order, which the concurrency test (B-13) checks.
  sequence     integer     NOT NULL,
  placed_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bids_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT bids_sequence_positive CHECK (sequence > 0),
  CONSTRAINT bids_sequence_unique UNIQUE (auction_id, sequence),
  -- Every new bid must beat the highest by at least the increment, so amounts strictly rise.
  -- A duplicate amount can only come from a concurrency bug; the database refuses it.
  CONSTRAINT bids_amount_unique UNIQUE (auction_id, amount_cents),
  -- Target of the foreign key from auction_state below.
  CONSTRAINT bids_highest_target UNIQUE (auction_id, id, bidder_id, amount_cents)
);

-- GET /bids/me (B-08): a user's bids, newest first.
CREATE INDEX bids_bidder_id_placed_at_idx ON bids (bidder_id, placed_at DESC);

-- The highest-bid copy in auction_state must be a real bid of the same auction, by the same
-- bidder, for the same amount. Deferred to COMMIT, because place-bid inserts the bid and updates
-- auction_state in one transaction, and the seed inserts auction_state before its bids.
ALTER TABLE auction_state
  ADD CONSTRAINT auction_state_highest_bid_fk
  FOREIGN KEY (auction_id, highest_bid_id, highest_bidder_id, highest_bid_cents)
  REFERENCES bids (auction_id, id, bidder_id, amount_cents)
  DEFERRABLE INITIALLY DEFERRED;

-- Idempotency-Key header on POST /auctions/:id/bids (B-10). Unique per user and key; the hash of
-- the request detects a reused key with a different body (409, docs/events.md §10).
-- response_status and response_body stay NULL while the first request is still running.
CREATE TABLE idempotency_keys (
  user_id         uuid        NOT NULL,
  key             text        NOT NULL,
  request_hash    text        NOT NULL,
  response_status smallint,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,

  CONSTRAINT idempotency_keys_pk PRIMARY KEY (user_id, key),
  CONSTRAINT idempotency_keys_key_format CHECK (key ~ '^[A-Za-z0-9_-]{1,255}$'),
  -- SHA-256 as 64 lowercase hex characters.
  CONSTRAINT idempotency_keys_request_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_keys_status_range CHECK (response_status BETWEEN 100 AND 599),
  CONSTRAINT idempotency_keys_response_complete CHECK (
    (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  )
);

-- Lets a cleanup job delete old keys by age.
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);

-- Event consumers must be idempotent (CLAUDE.md): an event ID is recorded in the same
-- transaction as its effect, so a redelivered event is skipped (task B-05).
CREATE TABLE processed_events (
  event_id     uuid        PRIMARY KEY,
  event_type   text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
