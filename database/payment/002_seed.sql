-- payment_db seed data (task A-16). Fixed IDs and amounts, safe to run again
-- (ON CONFLICT DO NOTHING). Each demo user from database/auth/002_seed.sql gets a wallet, and every
-- starting balance is backed by a DEPOSIT ledger entry, so balance always equals the ledger sum.
-- Amounts are EUR cents.
--   platform  0.00     collects the fees
--   admin     0.00
--   seller    100.00
--   bidder1   1000.00
--   bidder2   1000.00

BEGIN;

INSERT INTO wallets (id, kind, user_id, balance_cents, currency) VALUES
  ('40000000-0000-4000-8000-000000000000', 'PLATFORM', NULL, 0, 'EUR'),
  ('40000000-0000-4000-8000-000000000001', 'USER', '00000000-0000-4000-8000-000000000001', 0, 'EUR'),
  ('40000000-0000-4000-8000-000000000002', 'USER', '00000000-0000-4000-8000-000000000002', 10000, 'EUR'),
  ('40000000-0000-4000-8000-000000000003', 'USER', '00000000-0000-4000-8000-000000000003', 100000, 'EUR'),
  ('40000000-0000-4000-8000-000000000004', 'USER', '00000000-0000-4000-8000-000000000004', 100000, 'EUR')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (id, wallet_id, type, amount_cents, balance_after_cents) VALUES
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'DEPOSIT', 10000, 10000),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'DEPOSIT', 100000, 100000),
  ('50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'DEPOSIT', 100000, 100000)
ON CONFLICT (id) DO NOTHING;

COMMIT;
