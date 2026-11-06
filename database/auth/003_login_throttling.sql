-- Per-account login throttling (task A-23). A new numbered file: schema changes never edit
-- 001_schema.sql (CLAUDE.md, Database).
-- The gateway already limits login attempts per IP. This limits them per account, so slow guessing
-- spread over many IP addresses is stopped too. Rules: auth-service, LOGIN_* in .env.example.

BEGIN;

ALTER TABLE users
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD CONSTRAINT users_failed_login_count_not_negative CHECK (failed_login_count >= 0);

COMMIT;
