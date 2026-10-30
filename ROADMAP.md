# Online Auction Platform: Project Roadmap

**Course:** Web Services and Web APIs (Prof. Liridon Hoti)
**Team:** Member A and Member B (2 students)
**Hard deadline:** Fri **08.01.2027** (Moodle, one submission for the whole group)
**Internal target:** submit **Wed 06.01.2027**, which leaves 2 days of buffer
**Related files:** `TASKS.md` (who does what), `CLAUDE.md` (rules for Claude Code)

> **Stack confirmed by the team:** Node.js + TypeScript, PostgreSQL, Redis and RabbitMQ on the backend; React + Vite + TypeScript on the frontend. Changing it later needs both members to agree and `ROADMAP.md`, `TASKS.md` and `CLAUDE.md` updated in the same PR.

---

## 1. Project summary

A real-time online auction platform. Sellers list items, bidders place bids, the highest bidder wins when the timer ends, and payment is settled automatically between wallets.

The core technical problems, and the reason this project is worth doing:

1. **Concurrent bidding.** Many users bid on the same item at once, and the system must never accept two conflicting bids.
2. **Anti-sniping.** A bid placed in the last seconds extends the auction.
3. **Event-driven microservices.** Closing an auction triggers settlement and notifications across services.
4. **Real-time updates.** Live bid updates reach all connected clients through Server-Sent Events, even with several service replicas.
5. **Measurable results.** A load test with 500 simultaneous bids proves correctness and shows latency.

### Roles
| Role | Can do |
|---|---|
| BIDDER | Browse, bid, watch auctions, manage own wallet, see notifications |
| SELLER | Everything a bidder can, plus create, edit, publish and cancel own auctions |
| ADMIN | Manage users (ban, roles), manage categories, cancel any auction, view all settlements |

A user may hold both BIDDER and SELLER. ADMIN is seeded.

---

## 2. Scope

### MVP (must be finished)
- 5 microservices behind an Nginx gateway
- Register, login, refresh, logout with JWT and RBAC
- Auction CRUD, search, filter, pagination
- Bidding with concurrency safety, anti-sniping, idempotency
- Automatic closing, winner determination, reserve price
- Wallet, simulated deposit, automatic settlement with platform fee
- Notifications (in-app plus MailHog email simulation)
- Live auction page over SSE
- Tests, security tests, load test, logging, metrics
- Docker Compose, README, OpenAPI docs, presentation

### Stretch (only if ahead of schedule)
Pre-bid fund holds, auto-bid (proxy bidding), buy-it-now, transactional outbox, second-chance offer to the next bidder, Kubernetes manifests.

### Known limitations (state these openly at the defense)
- Funds are checked at bid time but not locked, so a user could bid on several auctions beyond their balance. Settlement then fails and the failure is handled (`payment.failed`).
- Payments are simulated with internal wallets. No real payment provider is used.

---

## 3. Architecture

```
  Browser (React)
        │  HTTPS
        ▼
  ┌───────────────────────────────────────────────┐
  │ Nginx gateway: TLS, rate limit, routing, LB   │
  └──┬──────────┬───────────┬───────────┬─────────┬┘
     ▼          ▼           ▼           ▼         ▼
 auth-svc   auction-svc  bidding-svc  payment-svc  notification-svc
   (A)         (A)        (B) x2        (A)          (B)
     │          │           │ │          │            │
  auth_db   auction_db  bidding_db      payment_db   notification_db
                              │ └── Redis (cache, pub/sub for SSE)
                              │
   RabbitMQ topic exchange "auction.events" connects all services
```

Rules:
- **Database per service.** One PostgreSQL container with 5 separate databases. No cross-database queries.
- **Synchronous calls** only where an immediate answer is needed (bidding to payment funds check, with timeout).
- **Asynchronous events** for everything else.
- Each service has the layers: routes, controllers, services (business logic), repositories (SQL only).

### Tech stack
| Concern | Choice | Why (defense answer) |
|---|---|---|
| Runtime | Node.js LTS + TypeScript | Type safety, one language for all services and frontend |
| HTTP framework | Express | Minimal, well known |
| Validation | zod | Server-side validation of body, query and params |
| Database | PostgreSQL 16 | ACID transactions and row-level locks are needed for bids and money |
| DB access | `pg` with parameterized queries, plain SQL migration files | SQL injection protection is visible and explainable |
| Cache and pub/sub | Redis 7 | Fast highest-bid reads, fan-out of SSE events across replicas |
| Message broker | RabbitMQ | Routing keys, DLQs, simpler than Kafka for this scale |
| Auth | JWT **RS256**, access 15 min, rotating refresh tokens, argon2id | Only auth-service holds the private key, so other services cannot forge tokens |
| Gateway / LB | Nginx | TLS, rate limiting, load balancing bidding replicas |
| Logging / metrics | pino, prom-client, Prometheus, Grafana | Structured logs and measurable behaviour |
| Tests | Jest + Supertest, Bruno collection, k6 | Automated, manual and load tests |
| Packaging | Docker Compose, GitHub Actions | Reproducible environment, CI |
| Frontend | React + Vite + TypeScript (thin), React Router, TanStack Query, MUI | Backend is what gets graded, so the UI stays small. Vite for fast dev, React Router for pages, TanStack Query for API calls and loading/error states, MUI so no time is lost on CSS, native `EventSource` for SSE |
| API docs | OpenAPI 3 + Swagger UI | Technical API documentation |

**JWT vs OAuth 2.0 (the professor stressed this):** JWT is a *token format*; OAuth 2.0 is an *authorization framework*. We issue our own JWTs from our own auth-service. OAuth 2.0 would be needed for third-party delegated access ("Login with Google"), which is out of scope.

### Services and ownership
| Service | Port | Owner | Responsibility |
|---|---|---|---|
| auth-service | 3001 | A | Users, roles, login, refresh, admin user management |
| auction-service | 3002 | A | Auction catalog, lifecycle, search, categories, watchlist |
| bidding-service | 3003 (x2) | B | Place bid, bid history, anti-sniping, closing worker, SSE |
| payment-service | 3004 | A | Wallets, ledger, settlement |
| notification-service | 3005 | B | Event consumers, in-app notifications, email simulation |
| gateway (Nginx) | 8080 / 8443 | A | Routing, TLS, rate limit, load balancing |
| shared lib | n/a | A (auth), B (rest) | JWT/RBAC middleware (A); logger, errors, event helpers (B) |

Supporting containers: PostgreSQL 5432, Redis 6379, RabbitMQ 5672/15672, MailHog 1025/8025, Prometheus 9090, Grafana 3000, frontend 5173 (Vite dev server; the built static files can be served by Nginx for the final demo).

---

## 4. Domain rules

**Auction states (persisted in auction-service):**
`DRAFT → PUBLISHED → CLOSED_SOLD / CLOSED_NO_SALE → SETTLED / PAYMENT_FAILED`, plus `CANCELLED`.
"Upcoming" and "live" are derived from `starts_at` and `ends_at` in API responses.

**Bidding rules (bidding-service):**
1. The auction must be open and `starts_at <= now < ends_at`.
2. The bid must be at least `current_highest + min_increment` (or the starting price for the first bid).
3. The seller cannot bid on their own auction.
4. The current highest bidder cannot outbid themselves.
5. The bidder must have enough wallet balance (checked with payment-service, 2 s timeout).
6. The `Idempotency-Key` header makes retries safe: the same key returns the original result.
7. **Anti-sniping:** if a bid arrives within `SNIPE_WINDOW_SECONDS` (default 30) of the end, `ends_at` is extended by `SNIPE_EXTENSION_SECONDS`, at most `MAX_EXTENSIONS` times.
8. Money is stored as **integer cents**, never floats.

**Closing and settlement:**
- A worker in bidding-service closes expired auctions using `FOR UPDATE SKIP LOCKED`, so it is safe with 2 replicas.
- If the highest bid is below the reserve price, the result is `CLOSED_NO_SALE`.
- Settlement (payment-service) runs in one DB transaction: debit winner, credit seller minus `PLATFORM_FEE_PERCENT` (default 5%), credit platform account, write ledger entries. It is idempotent per `auction_id`.
- Insufficient funds produce `payment.failed`.

**Seller rules:** edit only while `DRAFT`; cancel only before the first bid (admin can always cancel).

---

## 5. Planned API surface (base path `/api/v1`)

| Service | Endpoints |
|---|---|
| auth | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET/PATCH /users/me` · `GET /users` (ADMIN) · `PATCH /users/:id/status` (ADMIN) · `PATCH /users/:id/roles` (ADMIN) |
| auction | `GET /auctions` (q, category, status, price range, sort, page, size) · `GET /auctions/:id` · `POST /auctions` (SELLER) · `PATCH /auctions/:id` · `POST /auctions/:id/publish` · `POST /auctions/:id/cancel` · `DELETE /auctions/:id` (DRAFT) · `GET /categories` · `POST /categories` (ADMIN) · `GET/POST/DELETE /watchlist` |
| bidding | `POST /auctions/:id/bids` · `GET /auctions/:id/bids` · `GET /auctions/:id/state` · `GET /auctions/:id/stream` (SSE) · `GET /bids/me` |
| payment | `GET /wallet/me` · `POST /wallet/deposit` (simulated) · `GET /wallet/transactions` · `GET /payments` (ADMIN) · `GET /internal/funds-check` (blocked at the gateway) |
| notification | `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `POST /notifications/read-all` |

That is about 35 endpoints, well above the required 5. Gateway routing note: `/auctions/{id}/(bids|state|stream)` must be matched **before** the generic `/auctions` location, because it goes to bidding-service.

---

## 6. Event catalog (RabbitMQ topic exchange `auction.events`)

| Routing key | Publisher | Consumers | Purpose |
|---|---|---|---|
| `user.registered` | auth | notification | Welcome notification |
| `auction.created` | auction | bidding | Build local auction snapshot (start, end, price, increment, seller) |
| `auction.cancelled` | auction | bidding, notification | Stop accepting bids |
| `bid.placed` | bidding | notification | "You were outbid" |
| `auction.extended` | bidding | auction | Update displayed `ends_at` |
| `auction.closed` | bidding | auction, payment, notification | Result: sold or no sale, winner, amount |
| `payment.completed` | payment | auction, notification | Mark SETTLED, notify both parties |
| `payment.failed` | payment | auction, notification | Mark PAYMENT_FAILED, notify |

Envelope: `{ eventId, type, version, occurredAt, payload }`. Consumers are idempotent. After 3 retries a message goes to a dead-letter queue.

---

## 7. Timeline (10 weeks)

Hours per week are about 15 per person. Weeks 8 and 9 are holiday weeks, so they are kept lighter. Adjust to your exam schedule.

| Week | Dates | Focus | Milestone at end of week |
|---|---|---|---|
| 1 | 02.11 – 08.11 | Foundations: repo and frontend scaffold, Docker Compose, requirements, event contract, shared libs, DB schemas | **M0:** `docker compose up` starts infra with health checks |
| 2 | 09.11 – 15.11 | Auth service core, architecture doc, bidding place-bid core | |
| 3 | 16.11 – 22.11 | Admin/RBAC, auth tests, anti-sniping, bid queries, Redis cache, auction and payment schemas | |
| 4 | 23.11 – 29.11 | Auction CRUD and lifecycle, CI, idempotency, funds check (stubbed), closing worker | **M1:** Auth, Auction CRUD and Bidding core run standalone with tests |
| 5 | 30.11 – 06.12 | Search, events wired, wallet, bidding tests, notification consumers | |
| 6 | 07.12 – 13.12 | Settlement, gateway, SSE, notification API, watchlist and categories | **M2:** full lifecycle through the gateway: create, bid, close, settle, notify |
| 7 | 14.12 – 20.12 | Service tests, load balancing, live auction page, catalog UI | **M3: feature freeze** (no new backend features after this) |
| 8 | 21.12 – 27.12 | Seller UI, wallet/admin UI, performance tests, OpenAPI for bidding/notification (light week) | |
| 9 | 28.12 – 03.01 | Security hardening and tests, OpenAPI, observability, test evidence (light week) | **M4:** hardened, measured, all docs drafted |
| 10 | 04.01 – 06.01 | E2E test, README finalised, slides, defense rehearsal, packaging | **M5:** submitted Wed 06.01 (deadline Fri 08.01) |

Weekly ritual (30 min, Monday): review checkboxes in `TASKS.md`, agree on the week, review any API or event contract changes. In Week 7 each person walks the other through their services (1 hour each), because the professor can ask for a live change in any part of the code.

---

## 8. Requirement traceability (professor's sections)

| Section | Requirement | How we satisfy it | Evidence |
|---|---|---|---|
| 2 | Analysis, 5+ functional requirements, NFRs | `docs/requirements.md` with about 10 FR and security, performance, reliability and maintainability NFRs | A-02 |
| 3 | Layered architecture, REST, HTTP semantics, status codes, 5+ endpoints, **microservices mandatory** | 5 microservices, about 35 endpoints, standard error format, layered code | A-03, services |
| 4 | Real business logic | Bidding rules, anti-sniping, closing worker, settlement, state machines | B-06, B-07, B-11, A-18 |
| 5 | Database, CRUD, integrity, parameterized queries, seed data | PostgreSQL per service, constraints, `database/` init and seed scripts | database/ |
| 6 | Validation, SQLi protection, secrets, authn/authz, RBAC, JWT, HTTPS | zod, parameterized SQL, env vars, JWT RS256, 3 roles, Nginx TLS (self-signed locally, documented) | A-05, A-23 |
| 7 | Tests with input, expected and actual results, unauthorized cases | Jest/Supertest, Bruno collection, security suite, results table | B-18, A-23 |
| 8 | Response-time measurements, logging, limitations, caching, load balancing, queues, monitoring | k6 report, pino, Redis, Nginx with 2 bidding replicas, RabbitMQ, Prometheus/Grafana | B-19, B-17 |
| 9 | Clean code, Git, README | Layering, Conventional Commits, PRs, README | B-21 |
| 10 | Docker, env vars, documented versions | Docker Compose, `.env.example`, README | A-04, B-21 |
| 11 | Deliverables and folder structure | `backend/ frontend/ database/ tests/ docs/ scripts/`, ZIP without junk | B-21 |
| 12 | Demo and individual contribution | Demo script (section 11), `docs/contributions.md` | A-30, B-24 |
| 14 | Academic integrity, transparent AI use | `docs/ai-usage.md` log, both members can explain everything | CLAUDE.md |

### Questions to ask the professor (one short email in Week 1)
1. Are Kubernetes and advanced CI/CD required, or optional? (The text reads like "should".)
2. Are caching, load balancing, message queues and monitoring all required? (We plan them all.)
3. Is a frontend graded? (We plan a thin one.)
4. What format is expected for the AI-usage disclosure?
5. Is the written documentation expected in Albanian or English?

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Concurrency bug in bidding | Row lock inside a transaction, a dedicated concurrency test (50 parallel bids) from Week 5 |
| SSE breaks behind Nginx or across replicas | `proxy_buffering off`, long read timeout, Redis pub/sub fan-out; tested in Week 7 |
| Duplicate or lost events | Idempotent consumers, retries, DLQ, unique constraints |
| A and B blocked on each other | Event and API contracts agreed in Week 1; use stubs and publish scripts until the real service lands |
| Scope creep | Stretch list is frozen until M3; the cut list below |
| Holiday weeks lose time | Heavy backend work is front-loaded into Weeks 1–7 |
| Demo fails live | `scripts/demo.sh` with seeded data, a screen recording as fallback |
| One member falls behind | Rebalance by moving tasks in `TASKS.md` and noting it in `docs/contributions.md`, never silently |

### Cut list (drop in this order if behind)
1. Grafana dashboard (keep `/metrics` and Prometheus)
2. Admin UI pages (keep the API)
3. Watchlist
4. MailHog email (keep in-app notifications)
5. Circuit breaker (keep the timeout)
6. Frontend polish (keep the live auction page)

**Never cut:** bidding concurrency, settlement, JWT and RBAC, tests, README, load test.

---

## 10. Definition of Done (per task)

- Code is in the correct layer (no SQL in controllers, no business rules in routes)
- Input validated server-side, standard error format, correct status codes
- Tests written and passing (success, validation, 401/403/404, edge case)
- Logging added for errors and key events
- OpenAPI or docs updated if an endpoint or event changed
- PR reviewed by the other member, merged to `main`
- Checkbox ticked in `TASKS.md`

---

## 11. Defense plan

**Demo script (about 10 minutes):**
1. `docker compose up`, show all containers healthy.
2. Register a seller and two bidders. Show a 401 and a 403 case.
3. Seller creates and publishes a short auction (2 minutes).
4. Both bidders bid at the same time in two browser windows. Show live SSE updates.
5. Trigger anti-sniping with a late bid and show `ends_at` extended.
6. Auction closes. Show winner, wallet changes, ledger, notifications, and MailHog.
7. Show a validation error (400) and a conflict (409, bid too low).
8. Show the k6 result, a Grafana panel, and the test results table.

**Be ready for live changes** such as adding a field, a filter, or a validation rule. Both members rehearse these in Week 10.

**Ownership of talking points:**
- Member A: requirements, architecture, security (JWT, RBAC, SQLi), settlement, gateway and TLS.
- Member B: concurrency, events, caching, load balancing, performance results, observability.
- Both: each explains the other's main flow in one or two sentences, so neither looks like a passenger.
