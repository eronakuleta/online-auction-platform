# CLAUDE.md: Online Auction Platform

University group project (Web Services and Web APIs, deadline 08.01.2027), 2 students. A real-time auction platform built as **microservices**. Graded on working functionality, technical quality, documentation and the students' ability to **explain and modify the code live**. Read `ROADMAP.md` (design, rules, timeline) and `TASKS.md` (who does what) before starting work.

## How to work in this repo

1. **At the start of a session, find out which member you are working for** (A or B) if it is not obvious. Open their unchecked tasks in `TASKS.md` for the current week.
2. Work on **one task ID at a time**. Branch: `feat/<task-id>-<slug>`, e.g. `feat/B-06-place-bid`.
3. Implement, write tests, run lint and tests, then tick the checkbox in `TASKS.md`.
4. Do **not** edit files owned by the other member without asking. If you need a change there, describe it and let the user raise it with their teammate.
5. If a requirement is unclear, **ask**. Do not invent business rules that contradict `ROADMAP.md`.
6. After finishing a task, give a short plain-language explanation of what was built and why. The students must defend it. Append 3 to 5 bullet points to `docs/defense-notes/<member>.md` ("how to explain this at the defense").
7. **Academic integrity:** append an entry to `docs/ai-usage.md` for each task (date, task ID, what AI generated, what the student reviewed or changed). Add the trailer `Assisted-by: Claude Code` to commits. Prefer simple, readable code over clever code.

## Ownership

| Member A | Member B |
|---|---|
| `backend/services/auth-service`, `auction-service`, `payment-service` | `backend/services/bidding-service`, `notification-service` |
| `backend/shared/auth` | `backend/shared/*` except `auth` |
| `gateway/`, `.github/`, `docker-compose.yml` | `monitoring/`, `scripts/`, `README.md` |
| `frontend/src/pages/{auth,catalog,seller,wallet,admin}` | `frontend/src/pages/{auction-live,my-bids,notifications}` |
| `database/{auth,auction,payment}` | `database/{bidding,notification}` |
| `docs/requirements.md`, `architecture.md`, `api/{auth,auction,payment}.yaml` | `docs/events.md`, `performance-report.md`, `test-report.md`, `api/{bidding,notification}.yaml` |
| `tests/security`, `tests/e2e` | `tests/api-collection`, `tests/performance` |

Shared files (`docs/contributions.md`, `docs/ai-usage.md`, `TASKS.md`) can be edited by both, but only add your own entries.

## Tech stack

Node.js LTS + TypeScript, Express, zod, PostgreSQL 16 (`pg`, parameterized queries, plain SQL files), Redis 7, RabbitMQ, JWT RS256 + argon2id, Nginx, pino, prom-client, Jest + Supertest, k6, Bruno, Docker Compose, GitHub Actions. Frontend: React + Vite + TypeScript, React Router, TanStack Query, MUI (thin UI). **Do not add other frameworks, ORMs or major dependencies without asking.**

## Repository layout

```
backend/
  shared/                  # logger, errors, event helpers (B); auth middleware (A)
  services/
    auth-service/          # :3001
    auction-service/       # :3002
    bidding-service/       # :3003 (run 2 replicas)
    payment-service/       # :3004
    notification-service/  # :3005
gateway/                   # nginx.conf, TLS cert script
frontend/                  # React + Vite + TS, :5173 (src/{api,components,hooks,pages,utils})
database/<service>/        # NNN_schema.sql, NNN_seed.sql (mounted into Postgres init)
tests/{e2e,security,api-collection,performance}/
docs/                      # requirements, architecture, events, api/, reports, contributions, ai-usage
scripts/                   # start, reset, seed, demo, package
monitoring/                # prometheus.yml, grafana provisioning
docker-compose.yml  .env.example  README.md  ROADMAP.md  TASKS.md  CLAUDE.md
```

Inside every service:
```
src/
  config/        # env parsing and validation (fail fast on missing vars)
  routes/        # HTTP wiring only
  controllers/   # parse request, call service, shape response. No SQL, no business rules
  services/      # business logic. No Express imports, no SQL
  repositories/  # the ONLY place with SQL (parameterized)
  schemas/       # zod schemas for body, query, params
  events/        # publishers and consumers
  middleware/    # auth, validation, error handler
  jobs/          # background workers (e.g. closing worker)
  __tests__/
```

## Commands (create these in Week 1 if missing)

```
docker compose up -d                  # infra + all services
docker compose --profile monitoring up -d   # + Prometheus, Grafana
npm run lint                          # whole repo
npm test                              # all unit + integration tests
npm test -w backend/services/<name>   # one service
npm run dev -w frontend               # Vite dev server on :5173
npm run build -w frontend             # production build
scripts/reset-db.sh                   # drop and recreate all DBs with seed data
scripts/gen-keys.sh                   # generate JWT RSA keypair (never commit)
k6 run tests/performance/<script>.js
```

## Conventions

**API**
- Base path `/api/v1`. Plural, kebab-case nouns. Correct HTTP verbs: GET read, POST create/action, PATCH partial update, PUT full replace, DELETE remove.
- Status codes: `200` OK, `201` created (with `Location`), `204` no content, `400` invalid input, `401` missing or invalid token, `403` wrong role or not the owner, `404` not found, `409` state conflict (auction closed, bid too low, duplicate), `429` rate limited, `500` unexpected, `503` dependency unavailable.
- JSON `camelCase`. DB `snake_case`. IDs are UUIDs. Timestamps are ISO-8601 UTC (`timestamptz` in DB).
- **Money is integer cents** (`amountCents`) plus a `currency` field. Never use floats for money.
- Pagination: `?page=1&size=20` returns `{ "data": [...], "page": 1, "size": 20, "total": 134 }`. Cap `size` at 100.
- Standard error body (use the shared error handler, never hand-roll):
```json
{ "error": { "code": "BID_TOO_LOW", "message": "Bid must be at least 12500", "details": [], "requestId": "..." } }
```

**Frontend** (keep it thin; the backend is what is graded)
- Function components and hooks, TypeScript `strict`. Pages in `src/pages/<area>/`, shared UI in `src/components/`.
- One typed API client in `src/api/` (base URL from `VITE_API_BASE_URL`, pointing at the gateway). No `fetch` calls scattered in components.
- **TanStack Query** for all server state (queries and mutations), with loading and error states. **React Router** for navigation, with route guards by role.
- **MUI** components only. No custom design system and no extra UI libraries.
- Live bids: native `EventSource` on `/api/v1/auctions/:id/stream`, closed on unmount, with reconnect handling.
- Tokens: access token in memory, refresh token in `sessionStorage` (document this trade-off in the README). Never log tokens.
- The server is the authority for business rules. Show the server's error `code` and `message`; the UI may add light checks only to help the user.
- Format money in one util (`amountCents` to a currency string).
- Frontend tests are optional (Vitest + Testing Library if time allows). `npm run lint` and `npm run build` must pass.

**Events** (RabbitMQ topic exchange `auction.events`)
- Routing keys: `user.registered`, `auction.created`, `auction.cancelled`, `bid.placed`, `auction.extended`, `auction.closed`, `payment.completed`, `payment.failed`.
- Envelope: `{ eventId, type, version, occurredAt, payload }`. Payload schemas live in `docs/events.md`. Change them only with the other member's agreement.
- Consumers **must be idempotent** (unique constraint or processed-events table). Retry 3 times, then DLQ. Publish **after** the DB commit.

**Database**
- One database per service. Never query another service's database.
- Schema changes go in a new numbered SQL file under `database/<service>/`. Add constraints: PKs, FKs, `NOT NULL`, `CHECK` (e.g. `amount_cents > 0`), unique keys, and indexes for filtered columns.
- Seed data must be deterministic and safe to rerun on a fresh DB.

**Code style**
- TypeScript `strict`. No `any` without a comment. Small functions, descriptive names, DRY, early returns.
- Use the shared pino logger. **No `console.log`.** Log errors and key events (bid accepted or rejected, auction closed, settlement result) with the correlation ID. Never log passwords, tokens or full card-like data.
- Config only through env vars (`src/config`). Document every var in `.env.example`.

## Domain rules (do not weaken)

- **Place bid** (bidding-service): validate input (zod), look up the `Idempotency-Key`, do the funds check (HTTP, 2 s timeout) *before* the transaction so the row lock is not held during a network call, then:
  1. `BEGIN`, `SELECT ... FROM auction_state WHERE auction_id = $1 FOR UPDATE`
  2. Check: auction open, within `starts_at <= now < ends_at`, amount >= highest + `min_increment_cents`, bidder is not the seller, bidder is not already the highest bidder
  3. Insert the bid, update highest bid, bidder and version; apply anti-sniping (`ends_at += SNIPE_EXTENSION_SECONDS` if within `SNIPE_WINDOW_SECONDS`, at most `MAX_EXTENSIONS` times)
  4. `COMMIT`, then update Redis, publish `bid.placed` (and `auction.extended`), push to Redis pub/sub for SSE
- **Closing worker:** `... WHERE status = 'OPEN' AND ends_at <= now() FOR UPDATE SKIP LOCKED`. Below the reserve price means no sale. Publish `auction.closed`.
- **Settlement** (payment-service): one DB transaction. Debit the winner, credit the seller minus `PLATFORM_FEE_PERCENT`, credit the platform account, write ledger rows. Unique on `auction_id` so a replayed event does nothing. Insufficient funds publishes `payment.failed`.
- **Auction persisted states:** `DRAFT, PUBLISHED, CANCELLED, CLOSED_SOLD, CLOSED_NO_SALE, SETTLED, PAYMENT_FAILED`. Enforce valid transitions in the service layer.
- **Roles:** `BIDDER`, `SELLER`, `ADMIN` (a user can have several). Check roles with `requireRole()` middleware and check **ownership** in the service layer.

## Security rules (non-negotiable)

- Validate **all** input server-side (body, query, params, headers). Reject unknown fields where reasonable.
- **Never concatenate user input into SQL.** Use `$1, $2` parameters.
- Passwords: argon2id. Refresh tokens: stored hashed, rotated on use. Access token: RS256, 15 minutes. Only auth-service has the private key; others verify with the public key.
- Auth errors are generic ("invalid credentials") to avoid user enumeration.
- Secrets only in env vars. `.env`, keys and certs are gitignored. Only `.env.example` is committed.
- Internal endpoints (`/internal/*`) must not be routed by the gateway.
- Add `helmet`, a CORS allow-list, body size limits and rate limits. Protect every non-public endpoint with auth.
- HTTPS terminates at Nginx (self-signed locally; document this limitation in the README).

## Testing rules

- For every endpoint test: success, validation failure (400), no token (401), wrong role or not owner (403), not found (404), and at least one edge case.
- Integration tests use a **real Postgres** (CI service container), not mocked repositories.
- Concurrency test for bidding: many parallel bids give one consistent bid order and exactly one winner.
- Record evidence as a table in `docs/test-report.md`: `ID | Input | Expected | Actual | Pass/Fail`. Only list tests that were really run.
- Performance claims must come from measured k6 output saved under `tests/performance/results/`.

## Git

- Conventional Commits. Small commits. One PR per task, reviewed by the other member. No direct pushes to `main`.
- **Never commit:** `node_modules`, `dist`, `.env`, keys and certs, coverage output, temp files.
- The final ZIP (`scripts/package.sh`) must exclude generated and secret files, and must start with `docker compose up` plus the README steps.

## Don't

- Don't return hardcoded or static responses. Everything must hit the real logic and DB.
- Don't put SQL in controllers or business rules in routes.
- Don't use floats for money, or `console.log`.
- Don't tick a task as done if tests fail or the Definition of Done in `ROADMAP.md` is not met.
- Don't add stretch features before milestone M3 (feature freeze, 20.12.2026).
- Don't claim a performance figure, test result or feature that was not actually run or built.
