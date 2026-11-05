-- Catalog index for GET /auctions (task A-12). A new numbered file, because a schema change is never
-- made by editing 001_schema.sql (CLAUDE.md, Database).
--
-- The catalog filters on one status and, by default, shows the newest first. A-10's indexes already
-- cover "ending soon" (status, ends_at), price sorts (starting_price_cents) and search (GIN), but
-- the default order had to sort every published auction to find the first page. This index lets
-- Postgres read that page straight from the index.
--
-- Measured on 100,000 auctions (30,003 published), single runs, EXPLAIN ANALYZE:
--   newest first:                 32 ms (sorts 30,003 rows) -> 0.26 ms (reads 20 index entries)
--   one category, newest first:   13 ms (sorts 16,668 rows) -> 0.13 ms
-- A (status, starting_price_cents) index was also tried and dropped: no measurable gain.

BEGIN;

CREATE INDEX auctions_status_published_at_idx ON auctions (status, published_at DESC, id);

COMMIT;
