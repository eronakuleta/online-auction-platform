# Online Auction Platform

Erona Kuleta and Anesa's university project: five TypeScript/Express microservices, separate PostgreSQL databases, RabbitMQ events, Redis cache and SSE fan-out, with a React frontend behind an HTTPS API gateway.

## Requirements and setup

Use Node.js 24 LTS (`.nvmrc`), npm 10+, Docker Desktop with Compose v2 and Linux containers. Git Bash is needed only for the optional `.sh` wrappers. PowerShell can run every npm command directly. Allow several GB of Docker memory for the full stack and load tests.

```sh
npm ci
npm run start:stack
```

The start command copies `.env.example` to `.env` only when absent, generates local RSA keys only when absent, builds the images, and waits for health checks. On native Linux, make the generated private key readable by the container's `node` user (`chmod 644 secrets/jwt_private.pem`, local development only). Never commit `.env`, keys or certificates. Change the example passwords for any shared environment.

```sh
docker compose ps
npm run dev -w frontend
```

Open [the gateway health endpoint](https://localhost:8443/health) once and accept its local self-signed certificate, then open [the frontend](http://localhost:5173). The frontend reads the repository-root `.env`. HTTP port 8080 redirects to HTTPS 8443; backend API ports are internal. Stop without deleting data with `docker compose down`.

## Demo accounts and data

| Account              | Password        | Role           |
| -------------------- | --------------- | -------------- |
| admin@auction.test   | Admin#Demo2026  | ADMIN          |
| seller@auction.test  | Seller#Demo2026 | SELLER, BIDDER |
| bidder1@auction.test | Bidder#Demo2026 | BIDDER         |
| bidder2@auction.test | Bidder#Demo2026 | BIDDER         |

The five databases are initialized and seeded on a fresh volume. `npm run seed` safely reapplies the deterministic seeds without clearing data. `npm run reset-db -- --confirm` deletes this Compose project's database and broker volumes and recreates them; use only when you want to discard local auction data. `npm run demo` exercises registration, publish, bids, closing, settlement and notifications through the gateway. For the UI walkthrough and live-change drills see [Erona's demo](docs/defense-notes/erona-demo.md) and [Anesa's defense notes](docs/defense-notes/anesa.md).

## Verification

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
npm run test:stack
```

Integration tests create and drop isolated databases on the local Compose Postgres at port 5433. Override `TEST_DATABASE_URL` if needed. Set `TEST_REDIS_URL=redis://localhost:6379` to include real Redis tests. The broker helper tests require a **separate** broker via `RABBITMQ_TEST_URL` because they purge queues; do not target the running application broker. The gateway suites already exercise the real application broker without purging it. Stack tests automatically trust `gateway/certs/cert.pem` and run sequentially to avoid interfering fixtures. CI runs lint, formatting, types, builds, schemas/seeds, integration and gateway suites on every branch push.

See [test evidence](docs/test-report.md), [performance methodology and measured results](docs/performance-report.md), and [Bruno requests](tests/api-collection/README.md).

## Monitoring and API docs

```sh
docker compose --profile monitoring --profile docs up -d
```

[Prometheus](http://localhost:9090) discovers both bidding replicas via Docker DNS. Try `up`, `sum by (service) (rate(http_requests_total[1m]))`, or `histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))`. Every service exposes internal `/health` (database readiness) and `/metrics` (HTTP counters, latency histogram, Node/process metrics). Health checks do not represent broker or Redis readiness; Redis reads fall back to Postgres. Metrics and internal endpoints are blocked at the API gateway.

[Swagger UI](http://localhost:8081) serves all five [OpenAPI specs](docs/api/README.md). To try requests there, add `http://localhost:8081` to `CORS_ALLOWED_ORIGINS` in `.env` and recreate the gateway. See `.env.example` for all settings.

## Architecture and limits

Read [requirements](docs/requirements.md), [architecture](docs/architecture.md), [event contract](docs/events.md), [roadmap](ROADMAP.md) and [tasks](TASKS.md). SQL lives in repositories; bids lock one auction row; the closing worker uses `SKIP LOCKED`; settlement locks wallets and posts a balanced integer-cent ledger in one transaction. Idempotency keys and unique event/auction constraints make retries safe.

Money and payments are simulated. Bid-time funds checks do not reserve funds across auctions, so settlement can fail. There is no transactional outbox: a crash between commit and publish can lose an event. Banned users' existing access JWTs remain valid for at most 15 minutes. SSE reconnect sends a fresh snapshot rather than replaying every event. Local TLS is self-signed. Access JWTs live in memory; rotating refresh tokens live in `sessionStorage`, which is readable by injected scripts. See [frontend security trade-offs](frontend/README.md). Grafana, email, watchlists and admin UI are stretch features excluded from this submission.

## Submission

Commit the verified source, then run `npm run package`. The resulting `dist/online-auction-platform.zip` contains only the tracked source at HEAD, with a top-level project directory. It excludes dependencies, build artifacts, secrets and local settings. Extract it, run `npm ci` and `npm run start:stack` as above. Human rehearsal, peer approval and submission remain the students' responsibilities; automated evidence does not claim they occurred. AI assistance is recorded in [the disclosure](docs/ai-usage.md).
