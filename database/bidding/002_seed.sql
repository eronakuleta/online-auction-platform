-- bidding_db seed data (task B-04). Fixed IDs and contents, safe to run again
-- (ON CONFLICT DO NOTHING). Normally auction_state rows come from auction.published events; the
-- seed adds them directly so the published auctions in database/auction/002_seed.sql accept bids
-- on a fresh `docker compose up`. Times are relative to the moment the database is created, like
-- the auction seed, so the two can differ by the few seconds between the two init steps.
--
-- Seller: 00000000-0000-4000-8000-000000000002. Bidders: bidder1 ...0003, bidder2 ...0004
-- (database/auth/002_seed.sql). Prices are in EUR cents.
--   10000000-...-0001  live      2 bids, highest 5500 by bidder2, reserve 8000 not met yet
--   10000000-...-0002  live      no bids yet (first bid must be at least 2000)
--   10000000-...-0003  upcoming  bidding starts tomorrow
--   10000000-...-0006  CLOSED_NO_SALE, one bid of 12000 by bidder1, below the 25000 reserve
-- Drafts (...0004, ...0005) are not here: bidding-service only learns about published auctions.

BEGIN;

-- The highest-bid foreign key is deferred, so auction_state can refer to bids inserted below.
INSERT INTO auction_state (
  auction_id, seller_id, title, currency,
  starting_price_cents, min_increment_cents, reserve_price_cents,
  starts_at, ends_at, original_ends_at, status,
  highest_bid_id, highest_bid_cents, highest_bidder_id, bid_count, version, closed_at
) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   'Vintage 35mm film camera', 'EUR', 5000, 500, 8000,
   now() - interval '1 day', now() + interval '3 days', now() + interval '3 days', 'OPEN',
   '60000000-0000-4000-8000-000000000002', 5500, '00000000-0000-4000-8000-000000000004', 2, 2, NULL),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   'Signed match football', 'EUR', 2000, 200, NULL,
   now() - interval '2 hours', now() + interval '1 day', now() + interval '1 day', 'OPEN',
   NULL, NULL, NULL, 0, 0, NULL),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002',
   'Abstract oil painting, 60 x 80 cm', 'EUR', 15000, 1000, 20000,
   now() + interval '1 day', now() + interval '5 days', now() + interval '5 days', 'OPEN',
   NULL, NULL, NULL, 0, 0, NULL),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002',
   'Antique mantel clock', 'EUR', 10000, 500, 25000,
   now() - interval '10 days', now() - interval '3 days', now() - interval '3 days', 'CLOSED_NO_SALE',
   '60000000-0000-4000-8000-000000000003', 12000, '00000000-0000-4000-8000-000000000003', 1, 2,
   now() - interval '3 days')
ON CONFLICT (auction_id) DO NOTHING;

INSERT INTO bids (id, auction_id, bidder_id, amount_cents, sequence, placed_at) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000003', 5000, 1, now() - interval '20 hours'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000004', 5500, 2, now() - interval '5 hours'),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006',
   '00000000-0000-4000-8000-000000000003', 12000, 1, now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
