-- auction_db seed data (task A-10). Fixed IDs and contents, safe to run again
-- (ON CONFLICT DO NOTHING). Start and end times are relative to the moment the database is
-- created, so a fresh `docker compose up` always has live, upcoming and finished auctions.
--
-- All auctions belong to the demo seller from database/auth/002_seed.sql
-- (00000000-0000-4000-8000-000000000002). Prices are in EUR cents.
--
-- For Anesa (bidding_db seed, B-04): the PUBLISHED auctions below only accept bids if
-- bidding_db has a matching auction_state row (normally built from the publish event):
--   10000000-0000-4000-8000-000000000001  live      starting 5000, increment 500, reserve 8000
--   10000000-0000-4000-8000-000000000002  live      starting 2000, increment 200, no reserve
--   10000000-0000-4000-8000-000000000003  upcoming  starting 15000, increment 1000, reserve 20000

BEGIN;

INSERT INTO categories (id, name) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Electronics'),
  ('20000000-0000-4000-8000-000000000002', 'Art'),
  ('20000000-0000-4000-8000-000000000003', 'Collectibles'),
  ('20000000-0000-4000-8000-000000000004', 'Fashion'),
  ('20000000-0000-4000-8000-000000000005', 'Home and Garden'),
  ('20000000-0000-4000-8000-000000000006', 'Sports')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auctions (
  id, seller_id, category_id, title, description, currency,
  starting_price_cents, min_increment_cents, reserve_price_cents,
  starts_at, ends_at, status, published_at, closed_at
) VALUES
  -- Live: bidding is open now.
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000001', 'Vintage 35mm film camera',
   'Fully working rangefinder camera from 1978 with original leather case and 50mm lens.',
   'EUR', 5000, 500, 8000,
   now() - interval '1 day', now() + interval '3 days', 'PUBLISHED', now() - interval '1 day', NULL),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000006', 'Signed match football',
   'Football signed by the 2024 league champions, with certificate of authenticity.',
   'EUR', 2000, 200, NULL,
   now() - interval '2 hours', now() + interval '1 day', 'PUBLISHED', now() - interval '2 hours', NULL),
  -- Upcoming: published, bidding starts tomorrow.
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'Abstract oil painting, 60 x 80 cm',
   'Original oil on canvas by a local artist, signed and framed.',
   'EUR', 15000, 1000, 20000,
   now() + interval '1 day', now() + interval '5 days', 'PUBLISHED', now() - interval '1 hour', NULL),
  -- Drafts: visible only to the seller and admins (decision Q4).
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000001', 'Mechanical keyboard with wooden case',
   'Hot-swappable switches, ISO layout. Barely used.',
   'EUR', 6000, 500, NULL,
   now() + interval '2 days', now() + interval '7 days', 'DRAFT', NULL, NULL),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000004', 'Leather messenger bag',
   'Handmade full-grain leather bag. Draft: photos still missing.',
   'EUR', 4000, 250, 5000,
   now() + interval '3 days', now() + interval '10 days', 'DRAFT', NULL, NULL),
  -- Finished without a sale: no bids reached the reserve.
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003', 'Antique mantel clock',
   'Brass mantel clock from around 1900. Needs servicing.',
   'EUR', 10000, 500, 25000,
   now() - interval '10 days', now() - interval '3 days', 'CLOSED_NO_SALE',
   now() - interval '10 days', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auction_images (id, auction_id, url, position) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'https://picsum.photos/seed/film-camera/800/600', 0),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'https://picsum.photos/seed/film-camera-lens/800/600', 1),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'https://picsum.photos/seed/football/800/600', 0),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003',
   'https://picsum.photos/seed/oil-painting/800/600', 0),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004',
   'https://picsum.photos/seed/keyboard/800/600', 0),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006',
   'https://picsum.photos/seed/mantel-clock/800/600', 0)
ON CONFLICT (id) DO NOTHING;

COMMIT;
