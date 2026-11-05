# Task Division: Online Auction Platform

**Member A:** ____________________  **Member B:** ____________________

Both members have **155 estimated hours** (verified by script, see the balance table). Hours are estimates, not promises. Re-estimate in the Monday sync if needed.

How to read this file:
- `Wk` is the week number from `ROADMAP.md` (Week 1 starts 02.11.2026).
- `Deps` lists tasks that must be finished, or stubbed, first.
- Tick the `Done` box only when the Definition of Done in `ROADMAP.md` is met.
- Branch naming: `feat/A-11-auction-crud`. One PR per task, reviewed by the **other** member.

---

## Balance summary

| Area | Member A (h) | Member B (h) | Notes |
|---|---|---|---|
| Backend services and shared code | 64 | 81 | B owns the hardest domain code (bidding), A owns 3 of the 5 services |
| Infrastructure (repo setup, Compose, gateway, CI, observability) | 22 | 8 | A carries more infra |
| Security (hardening and security tests) | 8 | 0 | |
| Performance | 0 | 10 | |
| Testing | 18 | 17 | |
| Documentation and presentation | 22 | 21 | |
| Frontend | 15 | 12 | |
| Peer reviews | 6 | 6 | |
| **Total** | **155** | **155** | |

**Service ownership:** A = auth, auction, payment, gateway. B = bidding, notification, observability.

**Frontend stack:** React + Vite + TypeScript, React Router, TanStack Query, MUI. A scaffolds it in A-01 and owns the auth, catalog, seller, wallet and admin pages. B owns the live auction, my bids and notifications pages.

---

## Member A tasks

| ID | Task | Hrs | Wk | Deps | Done |
|---|---|---|---|---|---|
| A-01 | Repo skeleton: course folder structure, `.gitignore`, `.env.example`, PR template, branch rules, lint/format config; frontend scaffold (Vite + React + TS, React Router, MUI, TanStack Query, typed API client stub, `VITE_API_BASE_URL`) | 3 | 1 | none | [x] |
| A-02 | `docs/requirements.md`: problem, goals, actors and roles, about 10 functional requirements, NFRs (security, performance, reliability, maintainability), data sources, main processes | 5 | 1 | none | [ ] |
| A-03 | `docs/architecture.md`: component diagram, service boundaries, sync vs async, ER diagrams of all 5 DBs, justification of microservices and DB choice | 4 | 2 | B-01 | [ ] |
| A-04 | `docker-compose.yml` base: Postgres (5 DBs via init script), Redis, RabbitMQ, MailHog, healthchecks, networks, env wiring | 5 | 1 | A-01 | [ ] |
| A-05 | `backend/shared/auth`: JWT RS256 verify middleware, `requireRole()` RBAC, key-generation script | 4 | 1 | A-01 | [ ] |
| A-06 | auth-service: SQL schema (users, roles, refresh_tokens) and seed (admin, demo users) | 3 | 2 | A-04 | [ ] |
| A-07 | auth-service: register, login, refresh (rotation), logout, `GET/PATCH /users/me`, argon2id, zod validation | 8 | 2 | A-05, A-06 | [ ] |
| A-08 | auth-service: admin endpoints (list users, ban/unban, change roles) and `user.registered` event | 4 | 3 | A-07, B-02 | [ ] |
| A-09 | auth-service tests: unit and integration (valid, invalid, unauthorized, edge cases) | 5 | 3 | A-07, A-08 | [ ] |
| A-10 | auction-service: SQL schema (auctions, categories, images, watchlist) and seed (categories, sample auctions) | 4 | 3 | A-04 | [ ] |
| A-11 | auction-service: create, edit, publish, cancel, delete auction with ownership and state rules | 9 | 4 | A-05, A-10 | [ ] |
| A-12 | auction-service: list, search, filter, sort, paginate (parameterized queries, indexes) | 5 | 5 | A-11 | [ ] |
| A-13 | auction-service: publish `auction.created/cancelled`; consume `auction.extended`, `auction.closed`, `payment.*` to update status | 6 | 5 | A-11, B-02, B-03 | [ ] |
| A-14 | auction-service: watchlist endpoints and admin category management | 4 | 6 | A-11 | [ ] |
| A-15 | auction-service tests | 5 | 7 | A-11, A-12, A-13, A-14 | [ ] |
| A-16 | payment-service: SQL schema (wallets, ledger_entries, settlements with unique `auction_id`) and seed | 3 | 3 | A-04 | [ ] |
| A-17 | payment-service: wallet balance, simulated deposit, history, internal funds-check endpoint (blocked at gateway) | 6 | 5 | A-05, A-16 | [ ] |
| A-18 | payment-service: settlement consumer on `auction.closed` (atomic debit, credit, fee; idempotent; publishes `payment.completed/failed`) | 8 | 6 | A-17, B-11 | [ ] |
| A-19 | payment-service tests (duplicate event, insufficient funds, rounding of fee) | 4 | 7 | A-18 | [ ] |
| A-20 | Gateway: Nginx routing table, TLS (self-signed) with documented local limits, rate limiting, block `/internal` | 6 | 6 | A-04 | [ ] |
| A-21 | Gateway: load-balance bidding replicas (SSE-safe: buffering off, long read timeout) | 3 | 7 | A-20, B-12 | [ ] |
| A-22 | CI: GitHub Actions (lint, build, tests with service containers, docker build) | 5 | 4 | A-04 | [ ] |
| A-23 | Security hardening: helmet, CORS allow-list, body limits, login throttling, secrets audit; security test suite (SQLi payloads, missing/expired/forged JWT, RBAC matrix) | 8 | 9 | A-20 | [ ] |
| A-24 | OpenAPI 3 specs for auth, auction, payment plus Swagger UI | 6 | 9 | A-15, A-19 | [ ] |
| A-25 | Frontend: auth context with token refresh and role-based route guards, auth pages, catalog browse/search/filter, auction detail (read-only) | 5 | 7 | A-12 | [ ] |
| A-26 | Frontend: create/edit auction form, seller dashboard | 6 | 8 | A-25 | [ ] |
| A-27 | Frontend: wallet page and admin pages (users, categories) | 4 | 8 | A-25 | [ ] |
| A-28 | `tests/e2e`: full lifecycle through the gateway (register, create, bid, close, settle, notify) | 4 | 10 | all services | [ ] |
| A-29 | Presentation: requirements, architecture, security, own services | 3 | 10 | none | [ ] |
| A-30 | Defense prep: rehearse demo, live-change drills, update `docs/contributions.md` | 4 | 10 | none | [ ] |
| A-31 | Peer review of B's PRs (about 30 min per week) and the Week 7 walkthrough | 6 | 1–10 | none | [ ] |

---

## Member B tasks

| ID | Task | Hrs | Wk | Deps | Done |
|---|---|---|---|---|---|
| B-01 | `docs/events.md`: exchange, routing keys, payload schemas, versioning, retry/DLQ policy; API conventions (error format, pagination). Agree with A | 3 | 1 | none | [ ] |
| B-02 | `backend/shared`: pino logger with correlation IDs, error classes and Express error handler, publisher/consumer helpers (amqplib, ack/nack, retry) | 7 | 1 | B-01 | [ ] |
| B-03 | RabbitMQ topology script: topic exchange, per-service queues, DLQs, bindings | 3 | 1 | B-01 | [ ] |
| B-04 | bidding-service: SQL schema (auction_state, bids, idempotency_keys), indexes, seed | 4 | 1 | A-04 | [ ] |
| B-05 | bidding-service: consume `auction.created/cancelled` to build the local auction snapshot (test with a publish script until A-13 lands) | 4 | 2 | B-03, B-04 | [ ] |
| B-06 | bidding-service: `POST /auctions/:id/bids` with transaction and `SELECT ... FOR UPDATE`; rules (increment, not own auction, time window, not already highest) | 12 | 2 | B-04, A-05 | [ ] |
| B-07 | bidding-service: anti-sniping extension with max-extensions cap (env-configurable) and `auction.extended` event | 4 | 3 | B-06 | [ ] |
| B-08 | bidding-service: `GET /auctions/:id/bids` (paginated), `GET /auctions/:id/state`, `GET /bids/me` | 5 | 3 | B-06 | [ ] |
| B-09 | bidding-service: Redis cache of highest bid (write-through after commit), cache-aside for state, TTL and invalidation | 5 | 3 | B-06 | [ ] |
| B-10 | bidding-service: Idempotency-Key handling and funds check against payment-service with timeout and retry (use a stub until A-17 lands in Week 5, then switch to real) | 7 | 4 | B-06, A-17 | [ ] |
| B-11 | bidding-service: closing worker (`FOR UPDATE SKIP LOCKED`), winner and reserve-price logic, publishes `auction.closed` and `bid.placed` | 8 | 4 | B-06, B-07 | [ ] |
| B-12 | bidding-service: SSE `/auctions/:id/stream` with Redis pub/sub fan-out for 2 replicas, heartbeat | 8 | 6 | B-09, B-11 | [ ] |
| B-13 | bidding-service tests: unit, integration, concurrency test (50 parallel bids give one consistent order and winner) | 8 | 5 | B-06 to B-11 | [ ] |
| B-14 | notification-service: schema and consumers (welcome, outbid, won, lost, sold, payment completed/failed) | 8 | 5 | B-02, B-03 | [ ] |
| B-15 | notification-service: list, unread-count, mark read, read-all; email simulation via MailHog | 6 | 6 | B-14 | [ ] |
| B-16 | notification-service tests | 3 | 7 | B-14, B-15 | [ ] |
| B-17 | Observability: `/health` and `/metrics` on every service (shared helper), Prometheus and Grafana in a compose profile, one dashboard (latency, bids per second, errors) | 8 | 9 | all services | [ ] |
| B-18 | `tests/api-collection`: Bruno collection and results table (input, expected, actual) covering valid, invalid, boundary and unauthorized cases across all services; `docs/test-report.md` | 6 | 9 | all services | [ ] |
| B-19 | Performance: k6 scripts (read-heavy browsing, 500 concurrent bids on one auction), before/after caching, 1 vs 2 replicas, `docs/performance-report.md` with limitations | 10 | 8 | B-09, A-21 | [ ] |
| B-20 | Frontend: live auction page (native `EventSource` with cleanup and reconnect, countdown, bid form with server errors, history), my bids, notification bell; built on the A-01 scaffold with MUI and TanStack Query | 12 | 7 | B-12, B-15, A-01 | [ ] |
| B-21 | `README.md` (prerequisites, versions, setup, run, seed, test), `scripts/` (start, reset, seed demo data, `package.sh` to ZIP without `node_modules`, `.env`, keys). Draft the skeleton in Week 1, finalise in Week 10 | 7 | 10 | none | [ ] |
| B-22 | OpenAPI 3 specs for bidding and notification | 3 | 8 | B-13, B-16 | [ ] |
| B-23 | Presentation: bidding and concurrency, events, performance results, live-demo script | 4 | 10 | none | [ ] |
| B-24 | Defense prep: rehearse demo, live-change drills, update `docs/contributions.md` | 4 | 10 | none | [ ] |
| B-25 | Peer review of A's PRs (about 30 min per week) and the Week 7 walkthrough | 6 | 1–10 | none | [ ] |

---

## Working agreement (both members)

1. **Everyone commits.** Feature branches, small commits, Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`). No direct pushes to `main`.
2. **Cross-review.** Every PR is approved by the other member. This is also how each of you learns the other's code, because the professor may ask for a live change anywhere.
3. **Contracts first.** Changes to an API or event payload are agreed in the Monday sync (or chat) and updated in `docs/events.md` or the OpenAPI file in the same PR.
4. **Contribution log.** Each person adds a line per week to `docs/contributions.md` (what was done, task IDs, PR links). Section 12 of the requirements asks you to explain individual contribution.
5. **Rebalancing.** If someone falls behind, move a task to the other person *in this file* and note it in the log. Do not silently "help".
6. **AI transparency.** Log AI-assisted work in `docs/ai-usage.md` (see `CLAUDE.md`). Never submit code you cannot explain.

## Week-by-week view

| Week | Member A | Member B |
|---|---|---|
| 1 (17 / 17 h) | A-01, A-02, A-04, A-05 | B-01, B-02, B-03, B-04 |
| 2 (15 / 16 h) | A-03, A-06, A-07 | B-05, B-06 |
| 3 (16 / 14 h) | A-08, A-09, A-10, A-16 | B-07, B-08, B-09 |
| 4 (14 / 15 h) | A-11, A-22 | B-10, B-11 |
| 5 (17 / 16 h) | A-12, A-13, A-17 | B-13, B-14 |
| 6 (18 / 14 h) | A-14, A-18, A-20 | B-12, B-15 |
| 7 (17 / 15 h) | A-15, A-19, A-21, A-25 | B-16, B-20 |
| 8 (10 / 13 h) | A-26, A-27 | B-19, B-22 |
| 9 (14 / 14 h) | A-23, A-24 | B-17, B-18 |
| 10 (11 / 15 h) | A-28, A-29, A-30 | B-21, B-23, B-24 |
| Ongoing (6 / 6 h) | A-31 | B-25 |

## Defense ownership map

| Topic | Primary | Backup (must be able to explain) |
|---|---|---|
| Requirements and architecture | A | B |
| Auth, JWT, RBAC, security tests | A | B |
| Auction lifecycle and search | A | B |
| Settlement and ledger | A | B |
| Bidding concurrency and anti-sniping | B | A |
| Events, RabbitMQ, idempotency | B | A |
| Redis cache, SSE, load balancing | B | A |
| Performance results and monitoring | B | A |
| Test evidence | Both | Both |
