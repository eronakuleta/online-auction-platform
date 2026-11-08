-- notification_db seed data (task B-14). Fixed IDs and contents, safe to run again
-- (ON CONFLICT DO NOTHING). Times are relative to the moment the database is created.
--
-- It tells the same story as the other seeds (database/bidding/002_seed.sql), so a fresh
-- `docker compose up` shows a believable list in the notification bell:
--   bidder1 (...0003)  welcome (read), OUTBID on the film camera (unread, bidder2 bid 5500),
--                      AUCTION_LOST on the antique clock (read, reserve not met)
--   bidder2 (...0004)  welcome (read)
--   seller  (...0002)  welcome (read), NO_SALE for the antique clock (unread)
-- The admin gets none: admins have no wallet and no bids (decision Q13).
--
-- Auction IDs are from database/auction/002_seed.sql: ...0001 camera, ...0006 clock.

BEGIN;

INSERT INTO notifications (id, user_id, event_id, type, title, message, auction_id, read_at, created_at) VALUES
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
   '71000000-0000-4000-8000-000000000001', 'WELCOME', 'Welcome to the auction platform',
   'Hi Demo Seller, your account is ready. Create your first auction from the seller dashboard.',
   NULL, now() - interval '9 days', now() - interval '9 days'),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
   '71000000-0000-4000-8000-000000000002', 'WELCOME', 'Welcome to the auction platform',
   'Hi Demo Bidder One, your account is ready. Deposit some money in your wallet to start bidding.',
   NULL, now() - interval '9 days', now() - interval '9 days'),
  ('70000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
   '71000000-0000-4000-8000-000000000003', 'WELCOME', 'Welcome to the auction platform',
   'Hi Demo Bidder Two, your account is ready. Deposit some money in your wallet to start bidding.',
   NULL, now() - interval '9 days', now() - interval '9 days'),
  ('70000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003',
   '71000000-0000-4000-8000-000000000004', 'AUCTION_LOST', 'You did not win',
   '"Antique mantel clock" ended without a sale: the reserve price was not reached.',
   '10000000-0000-4000-8000-000000000006', now() - interval '2 days', now() - interval '3 days'),
  ('70000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002',
   '71000000-0000-4000-8000-000000000004', 'NO_SALE', 'Your auction ended without a sale',
   '"Antique mantel clock" did not reach the reserve price.',
   '10000000-0000-4000-8000-000000000006', NULL, now() - interval '3 days'),
  ('70000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000003',
   '71000000-0000-4000-8000-000000000005', 'OUTBID', 'You were outbid',
   'Someone placed a higher bid of €55.00 on "Vintage 35mm film camera".',
   '10000000-0000-4000-8000-000000000001', NULL, now() - interval '5 hours')
ON CONFLICT (id) DO NOTHING;

COMMIT;
