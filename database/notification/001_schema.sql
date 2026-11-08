-- notification_db schema (notification-service, owner: Anesa, task B-14).
-- Runs once, connected to notification_db, on a fresh Postgres volume (database/init-databases.sh).
-- In-app notifications built from events (docs/events.md §3). user_id and auction_id come from
-- other services' databases, so they have no foreign key: one database per service.

BEGIN;

CREATE TABLE notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The person who sees it. Not a foreign key: users live in auth_db.
  user_id    uuid        NOT NULL,
  -- The event that caused it. Together with user_id this makes event handling idempotent:
  -- a redelivered event finds its notifications already there (docs/events.md §7). One event
  -- never sends two notifications to the same person.
  event_id   uuid        NOT NULL,
  type       text        NOT NULL,
  title      text        NOT NULL,
  message    text        NOT NULL,
  -- The auction it is about, so the page can link to it. Null for the welcome message.
  auction_id uuid,
  -- NULL means unread.
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_type_known CHECK (type IN (
    'WELCOME', 'OUTBID', 'AUCTION_WON', 'AUCTION_LOST', 'ITEM_SOLD', 'NO_SALE',
    'AUCTION_CANCELLED', 'PAYMENT_COMPLETED', 'PAYMENT_FAILED'
  )),
  CONSTRAINT notifications_title_length CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT notifications_message_length CHECK (length(btrim(message)) BETWEEN 1 AND 1000),
  -- Only the welcome message is about no auction in particular; every other type names one.
  CONSTRAINT notifications_auction_matches_type CHECK ((type = 'WELCOME') = (auction_id IS NULL)),
  CONSTRAINT notifications_read_after_created CHECK (read_at IS NULL OR read_at >= created_at),
  CONSTRAINT notifications_event_user_unique UNIQUE (event_id, user_id)
);

-- GET /notifications: one user's notifications, newest first (id breaks ties between a batch
-- created in the same instant, so paging never skips or repeats a row).
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC, id);

-- GET /notifications/unread-count and read-all: only unread rows, which stay few, so the index
-- stays small however many read notifications pile up.
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

COMMIT;
