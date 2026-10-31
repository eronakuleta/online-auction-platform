# Task Division: Online Auction Platform

**Erona:** tasks `A-01` to `A-31`  **Anesa:** tasks `B-01` to `B-25`

> **Replanned on 30.10.2026** for the new hard deadline of **Mon 16.11.2026** (internal target Sat 14.11). See `ROADMAP.md` §7. Task IDs are unchanged: `A-xx` belongs to Erona and `B-xx` belongs to Anesa. Scope changes that touch Anesa's tasks are marked **proposed, Anesa to confirm** and do not take effect until she agrees.

Estimated hours: **Erona 126 h**, **Anesa 146 h** (core MVP, see the balance table). Hours are estimates, not promises. Re-estimate at the daily sync.

How to read this file:
- `Due` is the end of the sprint from `ROADMAP.md` §7 in which the task must be merged.
- `Deps` lists tasks that must be finished, or stubbed, first. Deps marked *(implicit)* follow from `CLAUDE.md` rules (every service must use the shared logger and error handler from B-02) and were added in the replan.
- `Status` (Erona's tasks only) is one of:
  - **Ready**: can start now
  - **Ready after A-xx**: waits only for Erona's own earlier task
  - **Blocked: B-xx**: pending until Anesa's task is merged. Do not start it.
  - **Waits for ... (→ B-xx)**: waits for Erona's own task, which is itself blocked by Anesa
- Anesa keeps the status of her own tasks. Nothing here marks her work as started or done.
- Tick the `Done` box only when the Definition of Done in `ROADMAP.md` is met.
- Branch naming: `feat/A-11-auction-crud`. One PR per task, reviewed by the **other** member.

---

## Balance summary

| Area | Erona (h) | Anesa (h) | Notes |
|---|---|---|---|
| Backend services and shared code | 57 | 80 | Anesa owns the hardest domain code (bidding), Erona owns 3 of the 5 services |
| Infrastructure (repo setup, Compose, gateway, CI, observability) | 19 | 5 | Erona carries more infra |
| Security (hardening and security tests) | 6 | 0 | |
| Performance | 0 | 10 | |
| Testing | 15 | 17 | |
| Documentation and presentation | 15 | 21 | |
| Frontend | 11 | 10 | |
| Peer reviews | 3 | 3 | |
| **Total** | **126** | **146** | Was 155 / 155 before the replan |

Anesa's numbers include the proposed cuts to B-15, B-17, B-20 and B-25. Her other estimates are unchanged. The 20 h gap is a known imbalance: rebalancing is done only by moving a task in this file with both members' agreement (Working agreement, point 5).

**Service ownership:** Erona = auth, auction, payment, gateway. Anesa = bidding, notification, observability.

**Frontend stack:** React + Vite + TypeScript, React Router, TanStack Query, MUI. Erona scaffolds it in A-01 and owns the auth, catalog, seller, wallet and admin pages. Anesa owns the live auction, my bids and notifications pages.

---

## Erona's tasks

| ID | Task | Hrs | Due | Deps | Status | Done |
|---|---|---|---|---|---|---|
| A-01 | Repo skeleton: course folder structure, `.gitignore`, `.env.example`, PR template, branch rules, lint/format config; frontend scaffold (Vite + React + TS, React Router, MUI, TanStack Query, typed API client stub, `VITE_API_BASE_URL`) | 3 | Tue 03.11 | none | In review | [x] |
| A-02 | `docs/requirements.md`: problem, goals, actors and roles, about 10 functional requirements, NFRs (security, performance, reliability, maintainability), data sources, main processes | 3 | Tue 03.11 | none | In review | [x] |
| A-03 | `docs/architecture.md`: component diagram, service boundaries, sync vs async, ER diagrams of all 5 DBs, justification of microservices and DB choice | 3 | Sun 08.11 | B-01 | Blocked: B-01 | [ ] |
| A-04 | `docker-compose.yml` base: Postgres (5 DBs via init script), Redis, RabbitMQ, healthchecks, networks, env wiring (MailHog moved to stretch) | 4 | Tue 03.11 | A-01 | In review (5 DBs, Redis, RabbitMQ healthy; verified with `docker compose up`) | [x] |
| A-05 | `backend/shared/auth`: JWT RS256 verify middleware, `requireRole()` RBAC, key-generation script | 4 | Tue 03.11 | A-01, B-02 *(implicit, for the 401/403 error classes)* | In progress: key script, token verification and role checks done; `authenticate()` / `requireRole()` middleware blocked on B-02 | [ ] |
| A-06 | auth-service: SQL schema (users, roles, refresh_tokens) and seed (admin, demo users) | 3 | Tue 03.11 | A-04 | In review (verified on Postgres; mounted by A-04) | [x] |
| A-07 | auth-service: register, login, refresh (rotation), logout, `GET/PATCH /users/me`, argon2id, zod validation | 8 | Sun 08.11 | A-05, A-06, B-02 *(implicit)* | Blocked: B-02 | [ ] |
| A-08 | auth-service: admin endpoints (list users, ban/unban, change roles) and `user.registered` event | 4 | Sun 08.11 | A-07, B-02 | Blocked: B-02 | [ ] |
| A-09 | auth-service tests: unit and integration (valid, invalid, unauthorized, edge cases) | 4 | Wed 11.11 | A-07, A-08 | Waits for A-07, A-08 (→ B-02) | [ ] |
| A-10 | auction-service: SQL schema (auctions, categories, images) and seed (categories, sample auctions). Watchlist table moved to stretch | 3 | Tue 03.11 | A-04 | In review (verified on Postgres 16 and loaded into the running stack) | [x] |
| A-11 | auction-service: create, edit, publish, cancel, delete auction with ownership and state rules | 8 | Sun 08.11 | A-05, A-10, B-02 *(implicit)* | Blocked: B-02 | [ ] |
| A-12 | auction-service: list, search, filter, sort, paginate (parameterized queries, indexes) | 4 | Wed 11.11 | A-11 | Waits for A-11 (→ B-02) | [ ] |
| A-13 | auction-service: publish `auction.created/cancelled`; consume `auction.extended`, `auction.closed`, `payment.*` to update status | 5 | Wed 11.11 | A-11, B-01, B-02, B-03 | Blocked: B-01, B-02, B-03 | [ ] |
| A-14 | auction-service: admin category management (`POST /categories`). Watchlist endpoints moved to stretch | 2 | Wed 11.11 | A-11 | Waits for A-11 (→ B-02) | [ ] |
| A-15 | auction-service tests | 4 | Fri 13.11 | A-11, A-12, A-13, A-14 | Waits for A-11 to A-14 (→ B-01, B-02, B-03) | [ ] |
| A-16 | payment-service: SQL schema (wallets, ledger_entries, settlements with unique `auction_id`) and seed | 3 | Tue 03.11 | A-04 | Ready after A-04 | [ ] |
| A-17 | payment-service: wallet balance, simulated deposit, history, internal funds-check endpoint (blocked at gateway) | 5 | Sun 08.11 | A-05, A-16, B-02 *(implicit)* | Blocked: B-02 | [ ] |
| A-18 | payment-service: settlement consumer on `auction.closed` (atomic debit, credit, fee; idempotent; publishes `payment.completed/failed`) | 8 | Wed 11.11 | A-17, B-02, B-11 | Blocked: B-02, B-11 | [ ] |
| A-19 | payment-service tests (duplicate event, insufficient funds, rounding of fee) | 4 | Fri 13.11 | A-18 | Waits for A-18 (→ B-02, B-11) | [ ] |
| A-20 | Gateway: Nginx routing table, TLS (self-signed) with documented local limits, rate limiting, block `/internal` | 5 | Sun 08.11 | A-04 | Ready after A-04 | [ ] |
| A-21 | Gateway: load-balance bidding replicas (SSE-safe: buffering off, long read timeout) | 3 | Fri 13.11 | A-20, B-12 | Blocked: B-12 | [ ] |
| A-22 | CI: GitHub Actions (lint, build, tests with service containers, docker build) | 4 | Tue 03.11 | A-04 | In progress: checks job, compose validation and Postgres 16 schema/seed job (same init script as Compose) run on every push; docker build steps follow the first service | [ ] |
| A-23 | Security hardening: helmet, CORS allow-list, body limits, login throttling, secrets audit; security test suite (SQLi payloads, missing/expired/forged JWT, RBAC matrix) | 6 | Fri 13.11 | A-20, A-07, A-11, A-17 | Waits for A-20 and the services (→ B-02) | [ ] |
| A-24 | OpenAPI 3 specs for auth, auction, payment plus Swagger UI | 4 | Sat 14.11 | A-15, A-19 | Waits for A-15, A-19 (→ B-01, B-02, B-03, B-11) | [ ] |
| A-25 | Frontend: auth context with token refresh and role-based route guards, auth pages, catalog browse/search/filter, auction detail (read-only) | 5 | Wed 11.11 | A-07, A-12 | Waits for A-07, A-12 (→ B-02) | [ ] |
| A-26 | Frontend: create/edit auction form, seller dashboard (dashboard is first on the cut list if late) | 4 | Fri 13.11 | A-25 | Waits for A-25 (→ B-02) | [ ] |
| A-27 | Frontend: wallet page. Admin pages moved to stretch (admin API stays) | 2 | Fri 13.11 | A-25, A-17 | Waits for A-25, A-17 (→ B-02) | [ ] |
| A-28 | `tests/e2e`: full lifecycle through the gateway (register, create, bid, close, settle, notify) | 3 | Sat 14.11 | all services | Blocked: all of Anesa's service tasks (B-06 to B-15) | [ ] |
| A-29 | Presentation: requirements, architecture, security, own services | 2 | Sat 14.11 | none | Ready (finalise last) | [ ] |
| A-30 | Defense prep: rehearse demo, live-change drills, update `docs/contributions.md` | 3 | Sat 14.11 | none | Ready (do last) | [ ] |
| A-31 | Peer review of Anesa's PRs (about 15 min per day) and the Thu 12.11 walkthrough | 3 | ongoing | none | Ongoing, as Anesa opens PRs | [ ] |

---

## Anesa's tasks

Only the `Due` column was re-dated for the new deadline. Wording, hours and dependencies are Anesa's, apart from the four rows marked **proposed, Anesa to confirm**.

| ID | Task | Hrs | Due | Deps | Done |
|---|---|---|---|---|---|
| B-01 | `docs/events.md`: exchange, routing keys, payload schemas, versioning, retry/DLQ policy; API conventions (error format, pagination). Agree with Erona. **Unblocks A-03 and A-13** | 3 | Tue 03.11 | none | [ ] |
| B-02 | `backend/shared`: pino logger with correlation IDs, error classes and Express error handler, publisher/consumer helpers (amqplib, ack/nack, retry). **Unblocks A-05, A-07, A-08, A-11, A-13, A-17, A-18** | 7 | Tue 03.11 | B-01 | [ ] |
| B-03 | RabbitMQ topology script: topic exchange, per-service queues, DLQs, bindings. **Unblocks A-13** | 3 | Tue 03.11 | B-01 | [ ] |
| B-04 | bidding-service: SQL schema (auction_state, bids, idempotency_keys), indexes, seed | 4 | Tue 03.11 | A-04 | [ ] |
| B-05 | bidding-service: consume `auction.created/cancelled` to build the local auction snapshot (test with a publish script until A-13 lands) | 4 | Sun 08.11 | B-03, B-04 | [ ] |
| B-06 | bidding-service: `POST /auctions/:id/bids` with transaction and `SELECT ... FOR UPDATE`; rules (increment, not own auction, time window, not already highest) | 12 | Sun 08.11 | B-04, A-05 | [ ] |
| B-07 | bidding-service: anti-sniping extension with max-extensions cap (env-configurable) and `auction.extended` event | 4 | Sun 08.11 | B-06 | [ ] |
| B-08 | bidding-service: `GET /auctions/:id/bids` (paginated), `GET /auctions/:id/state`, `GET /bids/me` | 5 | Wed 11.11 | B-06 | [ ] |
| B-09 | bidding-service: Redis cache of highest bid (write-through after commit), cache-aside for state, TTL and invalidation | 5 | Wed 11.11 | B-06 | [ ] |
| B-10 | bidding-service: Idempotency-Key handling and funds check against payment-service with timeout and retry (use a stub until A-17 lands, then switch to real) | 7 | Sun 08.11 | B-06, A-17 | [ ] |
| B-11 | bidding-service: closing worker (`FOR UPDATE SKIP LOCKED`), winner and reserve-price logic, publishes `auction.closed` and `bid.placed`. **Unblocks A-18** | 8 | Sun 08.11 | B-06, B-07 | [ ] |
| B-12 | bidding-service: SSE `/auctions/:id/stream` with Redis pub/sub fan-out for 2 replicas, heartbeat. **Unblocks A-21** | 8 | Wed 11.11 | B-09, B-11 | [ ] |
| B-13 | bidding-service tests: unit, integration, concurrency test (50 parallel bids give one consistent order and winner) | 8 | Fri 13.11 | B-06 to B-11 | [ ] |
| B-14 | notification-service: schema and consumers (welcome, outbid, won, lost, sold, payment completed/failed) | 8 | Wed 11.11 | B-02, B-03 | [ ] |
| B-15 | notification-service: list, unread-count, mark read, read-all. **Proposed, Anesa to confirm:** email simulation via MailHog moved to stretch (6 → 5 h) | 5 | Wed 11.11 | B-14 | [ ] |
| B-16 | notification-service tests | 3 | Fri 13.11 | B-14, B-15 | [ ] |
| B-17 | Observability: `/health` and `/metrics` on every service (shared helper), Prometheus in a compose profile. **Proposed, Anesa to confirm:** Grafana dashboard moved to stretch (8 → 5 h) | 5 | Fri 13.11 | all services | [ ] |
| B-18 | `tests/api-collection`: Bruno collection and results table (input, expected, actual) covering valid, invalid, boundary and unauthorized cases across all services; `docs/test-report.md` | 6 | Sat 14.11 | all services | [ ] |
| B-19 | Performance: k6 scripts (read-heavy browsing, 500 concurrent bids on one auction), before/after caching, 1 vs 2 replicas, `docs/performance-report.md` with limitations | 10 | Fri 13.11 | B-09, A-21 | [ ] |
| B-20 | Frontend: live auction page (native `EventSource` with cleanup and reconnect, countdown, bid form with server errors, history), my bids, notification bell; built on the A-01 scaffold with MUI and TanStack Query. **Proposed, Anesa to confirm:** frontend polish moved to stretch (12 → 10 h) | 10 | Fri 13.11 | B-12, B-15, A-01 | [ ] |
| B-21 | `README.md` (prerequisites, versions, setup, run, seed, test), `scripts/` (start, reset, seed demo data, `package.sh` to ZIP without `node_modules`, `.env`, keys). Draft the skeleton in Sprint 1, finalise on Sat 14.11 | 7 | Sat 14.11 | none | [ ] |
| B-22 | OpenAPI 3 specs for bidding and notification | 3 | Sat 14.11 | B-13, B-16 | [ ] |
| B-23 | Presentation: bidding and concurrency, events, performance results, live-demo script | 4 | Sat 14.11 | none | [ ] |
| B-24 | Defense prep: rehearse demo, live-change drills, update `docs/contributions.md` | 4 | Sat 14.11 | none | [ ] |
| B-25 | Peer review of Erona's PRs and the Thu 12.11 walkthrough. **Proposed, Anesa to confirm:** about 15 min per day over the shorter timeline (6 → 3 h) | 3 | ongoing | none | [ ] |

---

## Working agreement (both members)

1. **Everyone commits.** Feature branches, small commits, Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`). No direct pushes to `main`.
2. **Cross-review.** Every PR is approved by the other member. This is also how each of you learns the other's code, because the professor may ask for a live change anywhere.
3. **Contracts first.** Changes to an API or event payload are agreed in the daily sync (or chat) and updated in `docs/events.md` or the OpenAPI file in the same PR.
4. **Contribution log.** Each person adds a line per sprint to `docs/contributions.md` (what was done, task IDs, PR links). Section 12 of the requirements asks you to explain individual contribution.
5. **Rebalancing.** If someone falls behind, move a task to the other person *in this file* and note it in the log. Do not silently "help".
6. **AI transparency.** Log AI-assisted work in `docs/ai-usage.md` (see `CLAUDE.md`). Never submit code you cannot explain.
7. **Unblock first.** A task that blocks the other member (marked **Unblocks** above) goes before your own independent work.

## Sprint-by-sprint view

| Sprint (due) | Erona | Anesa |
|---|---|---|
| 1, Fri 30.10 – Tue 03.11 (27 / 17 h) | A-01, A-02, A-04, A-05, A-06, A-10, A-16, A-22 | B-01, B-02, B-03, B-04 |
| 2, Wed 04.11 – Sun 08.11 (33 / 35 h) | A-03, A-07, A-08, A-11, A-17, A-20 | B-05, B-06, B-07, B-10, B-11 |
| 3, Mon 09.11 – Wed 11.11 (28 / 31 h) | A-09, A-12, A-13, A-14, A-18, A-25 | B-08, B-09, B-12, B-14, B-15 |
| 4, Thu 12.11 – Fri 13.11 (23 / 36 h) | A-15, A-19, A-21, A-23, A-26, A-27 | B-13, B-16, B-17, B-19, B-20 |
| 5, Sat 14.11 (12 / 24 h) | A-24, A-28, A-29, A-30 | B-18, B-21, B-22, B-23, B-24 |
| Ongoing (3 / 3 h) | A-31 | B-25 |

Erona's three DB schemas (A-06, A-10, A-16), CI (A-22) and the gateway (A-20) were pulled forward, so she has independent work while her service tasks wait for B-02.

## Defense ownership map

| Topic | Primary | Backup (must be able to explain) |
|---|---|---|
| Requirements and architecture | Erona | Anesa |
| Auth, JWT, RBAC, security tests | Erona | Anesa |
| Auction lifecycle and search | Erona | Anesa |
| Settlement and ledger | Erona | Anesa |
| Bidding concurrency and anti-sniping | Anesa | Erona |
| Events, RabbitMQ, idempotency | Anesa | Erona |
| Redis cache, SSE, load balancing | Anesa | Erona |
| Performance results and monitoring | Anesa | Erona |
| Test evidence | Both | Both |
