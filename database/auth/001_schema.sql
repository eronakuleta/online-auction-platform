-- auth_db schema (auth-service, owner: Erona, task A-06).
-- Runs once, connected to auth_db, when the Postgres volume is created (see docker-compose, A-04).
-- Conventions: snake_case, UUID keys, timestamptz in UTC, constraints in the database as a last
-- line of defence behind the zod validation in the service.

BEGIN;

-- Lookup table, so a role name can only be one of the three the platform knows.
CREATE TABLE roles (
  name text PRIMARY KEY,
  CONSTRAINT roles_name_known CHECK (name IN ('BIDDER', 'SELLER', 'ADMIN'))
);

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercased and trimmed by the service; the CHECK makes "A@x.com" vs "a@x.com" impossible.
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  display_name  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_normalised CHECK (email = lower(btrim(email))),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  -- Only argon2id hashes are accepted, so a plain-text password can never be stored by mistake.
  CONSTRAINT users_password_is_argon2id CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT users_display_name_length CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  CONSTRAINT users_status_known CHECK (status IN ('ACTIVE', 'BANNED')),
  CONSTRAINT users_updated_after_created CHECK (updated_at >= created_at)
);

-- Admin list of users filters by status (FR-03).
CREATE INDEX users_status_idx ON users (status);

-- Many-to-many: a user can hold several roles (for example BIDDER and SELLER).
CREATE TABLE user_roles (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL REFERENCES roles (name),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Refresh tokens are stored only as a SHA-256 hash. They are long random values, so a fast hash
-- is enough (unlike passwords); a stolen database still cannot be used to log in.
-- Rotation: every refresh marks the old row used (replaced_by) and inserts a new row in the same
-- family. If a used token is presented again, auth-service can revoke the whole family (A-07).
CREATE TABLE refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  replaced_by uuid        REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  CONSTRAINT refresh_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_hash_is_sha256_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT refresh_tokens_revoked_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT refresh_tokens_not_replaced_by_itself CHECK (replaced_by IS NULL OR replaced_by <> id)
);

-- Logout and ban revoke all tokens of a user; reuse detection revokes a whole family.
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);

COMMIT;
