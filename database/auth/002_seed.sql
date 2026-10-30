-- auth_db seed data (task A-06). Deterministic: fixed IDs and fixed hashes, and safe to run again
-- (ON CONFLICT DO NOTHING), so every fresh start has the same demo accounts.
--
-- DEMO ACCOUNTS (local development and the defense demo only, never for a real deployment):
--   admin@auction.test    Admin#Demo2026    ADMIN
--   seller@auction.test   Seller#Demo2026   SELLER + BIDDER   (fallback seller for the demo, Q1)
--   bidder1@auction.test  Bidder#Demo2026   BIDDER
--   bidder2@auction.test  Bidder#Demo2026   BIDDER
--
-- Password hashes are argon2id (m=65536 KiB, t=3, p=4), generated once with the argon2 package.
-- User IDs are fixed version-4 UUIDs so other services' seeds (for example the demo seller's
-- auctions and wallets) can refer to the same users. Keep them in sync with those seeds.

BEGIN;

INSERT INTO roles (name) VALUES
  ('BIDDER'),
  ('SELLER'),
  ('ADMIN')
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (id, email, password_hash, display_name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin@auction.test',
   '$argon2id$v=19$m=65536,t=3,p=4$xT7RKE/r2YwWfwNzRDuYJw$R3F5bCijW74Sy9/bB6/i6IhbXYAa9iiKnOBeZ+ndocM',
   'Platform Admin'),
  ('00000000-0000-4000-8000-000000000002', 'seller@auction.test',
   '$argon2id$v=19$m=65536,t=3,p=4$d33NzcpKKRDMLvNzQgQ9PQ$EJKcPEC/6j077IxNx4RNzxDn7Se5zo/BM+mO+WTVkiQ',
   'Demo Seller'),
  ('00000000-0000-4000-8000-000000000003', 'bidder1@auction.test',
   '$argon2id$v=19$m=65536,t=3,p=4$D35ZwUSeVxWfisGkBuLOSA$vWzUwHZyC2oQLSLRnAKx0l6S7CzLfsNlay0NXfd06nI',
   'Demo Bidder One'),
  ('00000000-0000-4000-8000-000000000004', 'bidder2@auction.test',
   '$argon2id$v=19$m=65536,t=3,p=4$D35ZwUSeVxWfisGkBuLOSA$vWzUwHZyC2oQLSLRnAKx0l6S7CzLfsNlay0NXfd06nI',
   'Demo Bidder Two')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'ADMIN'),
  ('00000000-0000-4000-8000-000000000002', 'SELLER'),
  ('00000000-0000-4000-8000-000000000002', 'BIDDER'),
  ('00000000-0000-4000-8000-000000000003', 'BIDDER'),
  ('00000000-0000-4000-8000-000000000004', 'BIDDER')
ON CONFLICT (user_id, role) DO NOTHING;

COMMIT;
