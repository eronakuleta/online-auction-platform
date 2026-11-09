# Anesa: defense preparation and speaking outline

The saved slide deck is `page://page_4f310c8020608191aafb22518f25b00e` in Spaces. Export it from its viewer if a PowerPoint file is required. The following outline is also usable offline and belongs in the submission ZIP.

## 1. Concurrent bids (about one minute)

Explain that two replicas share PostgreSQL, rather than an in-memory lock. The funds HTTP call happens first so a network delay cannot hold an auction row lock. `SELECT FOR UPDATE` orders bids; each transaction validates against the latest committed bid, increments the sequence/version and commits before events and Redis updates. Show `backend/services/bidding-service/src/services/bidding.service.ts` and `concurrency.integration.test.ts`.

## 2. Closing and anti-sniping

Late bids extend the end by an environment-controlled amount with a cap. The worker uses the database clock, `FOR UPDATE SKIP LOCKED`, and reserve-price logic. Another worker skips a row already locked. The final highest bidder is the single winner; no sale produces no debit.

## 3. Events and notifications

Show `docs/events.md`: envelope, routing key, version, event ID and correlation header. A published auction creates the bidding snapshot; a close triggers payment and notifications independently. Redelivery is normal: unique keys or processed-events rows stop duplicate effects. Retry three times then DLQ. Without a transactional outbox, a process crash between commit and publish can lose an event; state this openly.

## 4. Redis and two replicas

Show the live page in two windows, with different bidders. The state endpoint is cache-aside; committed writes update Redis with an atomic version check. Pub/sub distributes the public state to each replica's SSE clients. Native EventSource reconnects, a heartbeat keeps the stream open, and version checks discard older messages. Redis failure falls back to Postgres for reads; cross-replica push can be interrupted until Redis returns.

## 5. Measurements

Use only the saved values in `docs/performance-report.md` and `tests/performance/results`. Explain the difference between an expected 409 for a losing low bid, a rate-limit 429, and an infrastructure 5xx. The isolated local performance override raises gateway limits and disables anti-sniping to measure bids and allow a prompt closing check. The runner restores the normal configuration afterward. Local short runs are not production capacity claims.

## 6. Runnable demonstration

Start with `npm run start:stack`, then `npm run demo`. It registers a winner, publishes two short auctions, places real bids with the wallet funds check, waits for the worker, verifies settlement/ledger and notification outcomes, and proves a reserve-not-met auction is not charged. For two-replica push run `npm run test:load-balancing` with `NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem`; for a shell-independent command use `npm run test:stack`.

Open Prometheus and query `up`, then `sum by (service) (rate(http_requests_total[1m]))`. Show the HTTP latency histogram. Separate SSE connection lifetime from normal request latency when interpreting the histogram.

## Live-change drills (perform these before submission)

1. Change the anti-sniping window through `.env`, recreate bidding-service and show the config test and anti-sniping tests. Explain why no SQL migration is needed.
2. Add a new public read filter: zod query schema, repository parameter, service argument, controller response, OpenAPI and one boundary/validation test. Never interpolate the filter into SQL.
3. Add a notification type: contract/event decision, pure builder, database CHECK migration, API enum and builder/consumer tests. Explain why changing only the UI cannot create a real notification.
4. Stop Redis, read live state to show DB fallback, restart Redis, reconnect the viewer, and explain that pub/sub does not replay missed messages.

Record actual rehearsal time, who drove each step, and the result in `docs/contributions.md`. Do not mark the student rehearsal or peer approval complete based only on an automated run.
