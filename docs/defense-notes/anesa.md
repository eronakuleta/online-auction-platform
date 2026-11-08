# Defense notes: Anesa

How to explain each of Anesa's tasks (`B-xx`) at the defense. Short, in our own words.

## B-01 Event contract and API conventions

- **Why a contract comes first.** Services never read each other's databases, so events are their only shared language. `docs/events.md` fixes the routing keys, the envelope and every payload, so both of us can build against it at the same time.
- **Why events carry `title` and `losingBidderIds`.** notification-service has to write "you lost the auction for X" without calling another service or reading another database. The publisher already knows these values, so it sends them.
- **Delivery is at-least-once, not exactly-once.** A message can arrive twice, so consumers deduplicate by `eventId` or a unique key such as `settlements.auction_id`. Retries can also change the order, so a consumer ignores any event that is not a valid state transition.
- **Why cancel goes through bidding-service (proposal 2).** "Only before the first bid" spans two databases. Bidding decides under the same `FOR UPDATE` row lock as place-bid, so a bid and a cancel at the same moment cannot both succeed.
- **Known limitation.** Without an outbox, an event is lost if a service crashes between `COMMIT` and publish. We say so openly.

## B-02 Shared logger, errors and event helpers

- **Correlation IDs without passing parameters.** `AsyncLocalStorage` keeps the ID for the current request or event, even across `await`. The logger adds it to every line, and it travels in the `x-correlation-id` message header, so one search follows a request across services. An incoming ID is checked against a safe pattern, which blocks log injection.
- **One error format, in one place.** Services throw `ConflictError('BID_TOO_LOW', ...)`, and the error handler builds the standard body. Unexpected errors become a generic `500`: the real message goes to the logs, never to the client.
- **The contract is enforced in code.** The publisher checks each payload with zod before sending, and the consumer checks it again on receipt. Money must be an integer above 0, so `10.5` fails at the publisher instead of corrupting another service.
- **No message is lost on failure.** A message is acknowledged only after its handler succeeds. To retry, the consumer copies it to the retry queue, waits for the broker's confirm, and only then acknowledges. A crash in between gives a duplicate at worst, which idempotent consumers handle.
- **Why a lost connection exits the process.** Reconnecting and re-subscribing correctly is a lot of code to get right. Exiting is simple and safe: Docker restarts the service, and unacknowledged messages are redelivered.

## B-03 RabbitMQ topology

- **Three queues per service.** The main queue receives events, the retry queue holds a failed message for 5 s, and the DLQ keeps messages that need a person to look at them. Retrying immediately would just fail again while the database is still down.
- **How the delay works without a plugin.** The retry queue has a message TTL and no consumers. When the TTL expires, RabbitMQ dead-letters the message back to the main queue.
- **Why retries skip the topic exchange.** They go through the default exchange, which routes by queue name. Republishing to the topic would hand the message again to every service, including those that already processed it.
- **Why all queues are declared together.** A topic exchange drops a message that no queue is bound to. Declaring every service's queues at setup means `bid.placed` is kept for notification-service even if that service has not started yet.
- **Safe to run repeatedly.** Declaring an existing queue with the same settings does nothing. That is why both `npm run rabbitmq:setup` and each service at startup can do it. Changing a queue's arguments later requires deleting the queue first, or RabbitMQ refuses the declaration.

## B-04 bidding_db schema

- **One locked row per auction.** `auction_state` holds everything place-bid needs: the end time, the increment and a copy of the highest bid. place-bid, the closing worker and the internal cancel call all lock this one row with `FOR UPDATE`, so they can never run at the same time for the same auction.
- **The copy cannot drift from the truth.** The highest-bid fields are a copy of one row in `bids`, kept for speed. A composite foreign key on `(auction_id, bid id, bidder, amount)` makes the database refuse a copy that does not match a real bid of that auction. It is deferred to `COMMIT` because place-bid inserts the bid and updates the state in the same transaction.
- **The database is the last safety net for concurrency.** Each bid must beat the highest by the increment, so amounts strictly rise: `UNIQUE (auction_id, amount_cents)` refuses a duplicate, and `UNIQUE (auction_id, sequence)` gives one clear bid order. If the row lock were ever missing, these would turn a silent bug into an error.
- **Business rules also live in `CHECK` constraints.** A `CLOSED_SOLD` auction must have met the reserve price, `CLOSED_NO_SALE` must not, the seller can never be the highest bidder, and `ends_at` can only move later than the published end. The service enforces the rules first; the constraints catch any mistake.
- **Events out of order.** If `auction.cancelled` arrives before `auction.published`, a `CANCELLED` placeholder row without the price snapshot is allowed. The later publish uses `ON CONFLICT DO NOTHING`, so it cannot reopen the auction.

## B-06 Place bid and internal cancel

- **The order of steps is the whole design.** `BEGIN`, lock the auction row with `FOR UPDATE`, read the time, check every rule, insert the bid, update the highest bid, `COMMIT`, and only then publish `bid.placed`. A second bid on the same auction waits at the lock, and when it continues it sees the first bid already applied.
- **Why `clock_timestamp()` and not `now()`.** `now()` is frozen when the transaction starts. A bid that waited 2 seconds for the lock would otherwise be checked against an old time and could slip in after the end. `clock_timestamp()` is read after the lock is granted, and it comes from Postgres, so two replicas share one clock.
- **Each rule has its own error code.** `BID_TOO_LOW` (409, with the minimum in the message), `ALREADY_HIGHEST_BIDDER` (409), `AUCTION_NOT_STARTED`, `AUCTION_CLOSED`, `AUCTION_CANCELLED` (409), `OWN_AUCTION` (403), `AUCTION_NOT_FOUND` (404). The frontend switches on the code, not the text.
- **Proving the lock matters.** A test holds the row lock from a second connection, sends a bid, cancels the auction, then releases the lock: the bid must answer `AUCTION_CANCELLED`. I removed `FOR UPDATE` on purpose and this test failed, so it really guards the lock.
- **Cancel and bid can never both win.** The internal cancel call takes the same lock, so whichever comes second sees the other's result: a bid after a cancel gets `AUCTION_CANCELLED`, a seller's cancel after a bid gets `AUCTION_HAS_BIDS`.

## B-07 Anti-sniping

- **What sniping is.** A bidder waits until the last second so nobody has time to answer. With anti-sniping, a bid in the last `SNIPE_WINDOW_SECONDS` (30) pushes the end back by `SNIPE_EXTENSION_SECONDS` (30), so the others always get a chance to react.
- **Why there is a cap.** Without `MAX_EXTENSIONS` (10) two bidders could keep an auction open forever. After 10 extensions a late bid is still accepted, but the end no longer moves.
- **It happens inside the same locked transaction as the bid.** The decision uses the time read after the lock, so two late bids cannot both extend from the same old end time. `auction.extended` is published after the commit, so auction-service can show the new end in the catalog.
- **A bug the database caught.** Postgres stores microseconds, a JavaScript `Date` only milliseconds. Writing `ends_at` back from JavaScript moved it slightly earlier, and the B-04 constraint `ends_at >= original_ends_at` refused it. The fix lets Postgres add the extension itself (`ends_at + make_interval(...)`).
- **The rule is a pure function** (`applyAntiSniping`), so its edge cases are tested without a database: exactly at the 30 s edge, just outside, and at the cap.

## B-11 Closing worker

- **What it does.** Every second it looks for open auctions whose end time has passed, decides the result, marks them `CLOSED_SOLD` or `CLOSED_NO_SALE`, and publishes `auction.closed` after the commit. Payment-service (Erona's A-18) settles a sold auction from that event.
- **Why `FOR UPDATE SKIP LOCKED`.** Two bidding replicas each run a worker. `SKIP LOCKED` makes a worker pass over any auction another transaction holds instead of waiting, so the two never close the same auction. A test runs two workers on 30 ended auctions: each is closed exactly once.
- **It cannot overlap a last-second bid.** place-bid and the worker lock the same row. If a bid holds the lock, the worker skips that auction for one round; the bid then sees `now >= ends_at` is not yet true or gets `AUCTION_CLOSED`, never a bid on a closed auction.
- **Result rules.** No bids: `NO_SALE` with `NO_BIDS`. Highest bid below the reserve: `NO_SALE` with `RESERVE_NOT_MET`. Otherwise `SOLD` to the highest bidder; equal to the reserve counts as met. `losingBidderIds` lists everyone who bid and did not win, so notification-service can tell them.
- **Failure handling.** If a round fails, its transaction rolls back and the next round tries again. If publishing fails after the commit, the auction stays closed and the event is lost; that is the known limitation without an outbox (`docs/events.md` §7).

## B-05 Auction snapshot from events

- **Why bidding keeps its own copy.** Bidding never reads auction_db (one database per service). It learns everything it needs (seller, prices, times) from `auction.published` and stores it in `auction_state`, so place-bid works even if auction-service is down.
- **Duplicates change nothing.** Delivery is at-least-once. Each handler records the `eventId` in `processed_events` in the same transaction as its effect; a redelivered event finds its ID there and does nothing.
- **Out-of-order events.** If `auction.cancelled` overtakes `auction.published`, a `CANCELLED` placeholder is stored. The late publish uses `ON CONFLICT DO NOTHING`, so it can never reopen a cancelled auction.
- **A cancel never overrides a result.** The cancel only changes an `OPEN` row. An auction that is already closed or cancelled (for example by the internal cancel call) is left as it is.
- **Bad data is not swallowed.** A snapshot that breaks a database rule makes the handler throw, so the shared consumer retries it and finally sends it to the dead-letter queue, where a person can look at it.

## B-10 Funds check and Idempotency-Key

- **Funds check before the lock.** Bidding asks payment-service `GET /internal/funds-check` before `BEGIN`, so the auction row is never locked while we wait for the network. A test proves another bidder can bid while payment-service is silent.
- **Timeout and retry, but not twice the wait.** Each call has a 2 s timeout. A quick failure (connection refused, 5xx) is tried once more; a timeout is not, because the bidder would wait 4 s. If payment cannot answer, the bid gets `503` and nothing is stored.
- **Checked, not reserved.** The balance is checked, not locked, so a user can bid on several auctions beyond their balance. That is the known limitation in ROADMAP §2; settlement then publishes `payment.failed`.
- **Idempotency-Key.** The first request with a key claims it in `idempotency_keys` (unique per user and key) and stores its answer. A retry with the same key and the same request gets the stored answer (`Idempotent-Replayed: true`) and never places a second bid; the same key with a different request is `409 IDEMPOTENCY_KEY_REUSED`.
- **Which answers are stored.** A rule rejection (4xx) is the real answer, so it is replayed too. A 503 or a bug may work next time, so the key is freed and the retry really runs again. A key left unfinished by a crash is taken over after 60 s.

## B-08 Bid history, live state and my bids

- **Decision Q3: public and read-only.** Bid history and live state need no token, like the catalog and the SSE stream. They never contain the reserve price (decision Q8). Only `GET /bids/me` needs a login, because it is about one user.
- **Why the state endpoint exists.** The live page loads it once, then follows the SSE stream (B-12). It includes `minimumNextBidCents`, so the page can show the lowest valid bid; the server still checks every bid itself.
- **Reads do not lock.** Unlike place-bid, these queries use plain `SELECT` without `FOR UPDATE`, so a page full of readers never slows down bidding.
- **Pagination follows the team convention.** `?page=1&size=20`, size capped at 100, and `{ data, page, size, total }`. History is ordered by `sequence`, which the unique `(auction_id, sequence)` index already serves.
- **My bids shows `isHighest`.** It compares each bid with the auction's `highest_bid_id`, so the page can show "you are winning" or "outbid" without a second request.

## B-09 Redis cache of the live state

- **What is cached.** Each auction's live state (highest bid, bidder, end time, status, version) under `auction:<id>:state` for 30 s. The database stays the source of truth; Redis only makes reads fast.
- **Write-through and cache-aside.** After a bid commits, the new state is written straight into Redis (write-through). `GET /state` reads Redis first and only on a miss asks Postgres and fills the cache (cache-aside).
- **Why the version check (Lua).** With two replicas, version 5 and version 6 can reach Redis in the wrong order. A small Lua script, which Redis runs atomically, only writes if the cached version is older, so an old state never replaces a newer one.
- **No plain delete on cancel or close.** Instead of deleting the key, the fresh state with its higher version is written. A delete would let a late, older write bring back an "open" auction; the version check makes that impossible.
- **Redis is optional.** Every cache call has a 200 ms timeout and the client has no offline queue, so when Redis is down calls fail at once and the service reads Postgres. A test points the cache at a dead port and bidding still works.

## B-12 Live updates with SSE and Redis pub/sub

- **Why SSE and not WebSockets.** The page only needs updates from server to browser, and the browser's `EventSource` reconnects by itself. It cannot send an `Authorization` header, so the stream is public and read-only (proposal 1, decision Q3); it carries only public data and never the reserve price.
- **What a viewer receives.** First the current state, then one `state` event per change (a bid, an anti-sniping extension, a close, a cancel). `id` is the state's version, so the page can ignore an update older than one it already shows; a `: heartbeat` comment every 15 s keeps the connection alive.
- **Why Redis pub/sub (two replicas).** A viewer is connected to one replica, but the bid can arrive at the other. After a bid commits, the new state is published on `auction:<id>:live`; every replica is subscribed and pushes it to its own viewers. A test places the bid on replica A and a viewer on replica B receives it exactly once.
- **The database stays the truth.** A lost live update never turns a committed bid into an error. If Redis is down, the update is still delivered to this replica's viewers, and the page can always reload `GET /state`.
- **Cleanup and shutdown.** A viewer who disconnects is forgotten at once (tested), the heartbeat timer does not keep the process alive, and on shutdown the open streams are closed first, because they never end by themselves and would block `server.close()`.

## B-14 notification-service: schema and event consumers

- **Notifications are built from events, not from calls.** notification-service never asks another service anything. It subscribes to six events (`user.registered`, `bid.placed`, `auction.closed`, `auction.cancelled`, `payment.completed`, `payment.failed`) and each carries what the message needs (title, amounts, bidders), so it stays independent of the other databases.
- **One pure function decides who is told what.** `notification-builder.ts` turns an event into notifications with no database and no network, so every rule is tested exactly (for example: nobody is outbid by themselves, a seller who cancelled their own auction is not told). The rules are written down as decision Q14.
- **Idempotency by a unique key.** Delivery is at-least-once, so an event can arrive twice. `UNIQUE (event_id, user_id)` plus `ON CONFLICT DO NOTHING` means a redelivery, five deliveries at once, or a retry after a half-finished first attempt all end with exactly the notifications that should exist.
- **If the database fails, nothing is lost.** The handler throws, so the shared consumer retries it three times and then moves the message to the dead-letter queue, where a person can look at it. A test drops the table to show the handler really fails instead of hiding the error.
- **The schema defends itself.** `CHECK` constraints refuse unknown types, empty or too long text, a welcome message about an auction and any other type without one. The list and the unread count each get an index (a partial one for unread, which stays small), and a test shows Postgres can use them.
