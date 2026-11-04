-- payment_db schema (payment-service, owner: Erona, task A-16).
-- Runs once, connected to payment_db, on a fresh Postgres volume (database/init-databases.sh).
-- Simulated wallets, an append-only ledger and one settlement per auction. User and auction IDs
-- come from other services, so they have no foreign keys: one database per service.
--
-- Event consumers are idempotent through natural unique keys (docs/events.md section 7), so this
-- database needs no processed_events table: UNIQUE (user_id) on wallets for user.registered, and
-- UNIQUE (auction_id) on settlements for auction.closed.

BEGIN;

CREATE TABLE wallets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A USER wallet belongs to one user. The single PLATFORM wallet collects the fees.
  kind          text        NOT NULL DEFAULT 'USER',
  user_id       uuid,
  -- Integer cents. The CHECK makes overspending impossible, even if the service has a bug.
  balance_cents bigint      NOT NULL DEFAULT 0,
  currency      char(3)     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_kind_known CHECK (kind IN ('USER', 'PLATFORM')),
  CONSTRAINT wallets_owner_matches_kind CHECK ((kind = 'USER') = (user_id IS NOT NULL)),
  CONSTRAINT wallets_user_unique UNIQUE (user_id),
  CONSTRAINT wallets_balance_not_negative CHECK (balance_cents >= 0),
  CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT wallets_updated_after_created CHECK (updated_at >= created_at)
);

-- At most one platform wallet can exist.
CREATE UNIQUE INDEX wallets_one_platform ON wallets (kind) WHERE kind = 'PLATFORM';

-- One row per auction.closed with result SOLD. A replayed event hits UNIQUE (auction_id) and does
-- nothing. A failed payment is recorded too, so a replay cannot succeed later and contradict the
-- payment.failed event that was already sent.
CREATE TABLE settlements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id     uuid        NOT NULL,
  winner_id      uuid        NOT NULL,
  seller_id      uuid        NOT NULL,
  amount_cents   bigint      NOT NULL,
  currency       char(3)     NOT NULL,
  status         text        NOT NULL,
  -- Only for COMPLETED: fee = floor(amount * PLATFORM_FEE_PERCENT / 100), seller = amount - fee.
  fee_cents      bigint,
  seller_cents   bigint,
  -- Only for FAILED. Same values as the reason field of payment.failed.
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_auction_unique UNIQUE (auction_id),
  CONSTRAINT settlements_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT settlements_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT settlements_winner_not_seller CHECK (winner_id <> seller_id),
  CONSTRAINT settlements_status_known CHECK (status IN ('COMPLETED', 'FAILED')),
  CONSTRAINT settlements_fields_match_status CHECK (
    CASE status
      WHEN 'COMPLETED'
        THEN fee_cents IS NOT NULL AND seller_cents IS NOT NULL AND failure_reason IS NULL
      ELSE fee_cents IS NULL AND seller_cents IS NULL AND failure_reason IS NOT NULL
    END
  ),
  CONSTRAINT settlements_failure_reason_known CHECK (
    failure_reason IS NULL OR failure_reason IN ('INSUFFICIENT_FUNDS', 'WALLET_NOT_FOUND')
  ),
  CONSTRAINT settlements_fee_not_negative CHECK (fee_cents >= 0),
  CONSTRAINT settlements_seller_not_negative CHECK (seller_cents >= 0),
  -- No money is created or lost when an amount is split.
  CONSTRAINT settlements_split_adds_up CHECK (fee_cents + seller_cents = amount_cents)
);

-- GET /payments (admin) lists the newest first.
CREATE INDEX settlements_created_at_idx ON settlements (created_at DESC);

-- Every balance change writes one row, so a balance can always be explained and recomputed.
-- The service only ever inserts here. Rows are never updated or deleted.
CREATE TABLE ledger_entries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           uuid        NOT NULL REFERENCES wallets (id),
  type                text        NOT NULL,
  -- Signed: positive adds money to the wallet, negative takes it out.
  amount_cents        bigint      NOT NULL,
  balance_after_cents bigint      NOT NULL,
  settlement_id       uuid        REFERENCES settlements (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_type_known CHECK (type IN (
    'DEPOSIT', 'SETTLEMENT_DEBIT', 'SETTLEMENT_CREDIT', 'PLATFORM_FEE'
  )),
  CONSTRAINT ledger_sign_matches_type CHECK (
    CASE type
      WHEN 'SETTLEMENT_DEBIT' THEN amount_cents < 0
      -- A sale can be so small that the fee rounds down to 0, and then no fee row is written.
      ELSE amount_cents > 0
    END
  ),
  CONSTRAINT ledger_balance_not_negative CHECK (balance_after_cents >= 0),
  CONSTRAINT ledger_settlement_matches_type CHECK ((type = 'DEPOSIT') = (settlement_id IS NULL)),
  -- A settlement can move money on a wallet only once per entry type.
  CONSTRAINT ledger_settlement_entry_unique UNIQUE (settlement_id, wallet_id, type)
);

-- GET /wallet/transactions lists one wallet's entries, newest first.
CREATE INDEX ledger_wallet_created_at_idx ON ledger_entries (wallet_id, created_at DESC);

COMMIT;
