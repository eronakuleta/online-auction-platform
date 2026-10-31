# Defense notes: Erona

How to explain each of Erona's tasks (`A-xx`) at the defense. Short, in our own words.

## A-01 Repo skeleton and frontend scaffold

- **Monorepo with npm workspaces.** One repo, one `npm install`, one lint config. Each service and the frontend is its own workspace package, so `npm test -w backend/services/auth-service` runs one service alone, but they share tooling.
- **Lint rules enforce our own rules.** ESLint fails on `console.log` (we must use the pino logger) and on `any`. Prettier formats everything the same way, so reviews are about logic, not style. `.gitattributes` forces LF line endings, because shell and SQL scripts with Windows CRLF break inside Linux containers.
- **Secrets never reach git.** `.gitignore` blocks `.env`, keys and certs. `.env.example` lists every variable with a comment and placeholder values, and is the only env file that is committed.
- **One typed API client** (`frontend/src/api/client.ts`). It adds the bearer token, parses JSON and turns the backend's standard error body into an `ApiError` with `code` and `message`, so the UI shows the server's message. The access token lives in a module variable (memory), not in localStorage. The base URL comes from `VITE_API_BASE_URL` and the app fails fast if it is missing.
- **Money formatting never uses floats.** `formatMoney` builds an exact decimal string (`12345` cents to `"123.45"`) with integer math and passes it to `Intl.NumberFormat`. It rejects non-integer cents. TypeScript is pinned to 6.0 because `typescript-eslint` does not support TypeScript 7 yet.

## A-02 Requirements

- **Problem first, then goals.** The interesting part of an auction is not CRUD but concurrency (two bids at once), sniping, exactly-once money movement and live state across replicas. Each goal (G1–G6) says how it is measured, so we never claim something we did not test.
- **Functional requirements are traceable.** FR-01 to FR-14 each list the actor, the endpoints, the priority (MoSCoW) and the task that builds them. The auction state machine in FR-04 is a table of allowed transitions; anything else is `409`.
- **Two kinds of checks: role and ownership.** The permission matrix shows what each role may do. A role check (`requireRole('SELLER')`) runs in middleware, but "is this your auction?" needs the database, so it runs in the service layer.
- **NFRs are targets until measured.** Security NFRs map to concrete mechanisms (argon2id, RS256, parameterized SQL, helmet, rate limits). Performance numbers (for example p95 < 500 ms for bids) are explicitly targets; only the k6 results are evidence.
- **Open questions instead of invented rules.** Where the roadmap does not decide something (how a user becomes a seller, which profile fields are editable, who sees drafts), the document lists the options and who decides, instead of guessing.
- **Decision Q1: only an admin grants `SELLER`.** Registration always creates a plain `BIDDER`, and a `roles` field in the register body is rejected (`400`), so nobody can make themselves a seller. Because roles are inside the JWT, a granted role applies after the next refresh (at most 15 minutes), which is the same trade-off as for banned users.
- **Decision Q2: `PATCH /users/me` changes only `displayName`.** The zod schema is strict, so sending `email`, `roles` or any unknown field gives `400`. Keeping email fixed avoids uniqueness races and re-verification, and closes a mass-assignment hole (a user cannot send `roles: ["ADMIN"]`).
- **Decision Q4: a draft is visible only to its seller and admins, and everyone else gets `404`.** Returning `403` would confirm that the auction exists, which leaks information (the same idea as generic "invalid credentials" on login). This is an ownership check, so it lives in the auction service layer, not in `requireRole()`.

## A-05 Shared auth (part 1: verification core)

- **Why RS256 and not HS256.** auth-service signs tokens with a private key; every other service verifies with the public key. A service that is compromised can read tokens but cannot create them. With HS256 every service would share one secret and could forge tokens. `loadPublicKey()` even refuses to load a file that contains a private key.
- **What `createTokenVerifier()` checks, in order.** Signature with the RSA public key, `algorithms: ['RS256']` only, issuer, audience and expiry (5 s clock tolerance between containers), then the claims with zod: `sub` must be a UUID and `roles` a non-empty list of known roles. A wrongly shaped token is rejected even if the signature is valid.
- **Attacks the tests prove we block.** A forged signature (attacker's key), a payload edited after signing (`roles: ['ADMIN']`), `alg: none`, and algorithm confusion (an HS256 token "signed" with our public key as the secret). Each one is rejected as `INVALID`; an old token is `EXPIRED`. 34 tests in total.
- **Role check vs ownership check.** `hasAnyRole()` answers "is this user a SELLER?" and becomes the `requireRole()` middleware. "Is this _your_ auction?" needs the database, so it is checked in each service's business layer.
- **Why the Express middleware is not here yet.** `authenticate()` and `requireRole()` must answer 401/403 in the standard error format, which uses Anesa's shared error classes from B-02. To avoid duplicating her work, they are added after B-02 lands. Keys come from `npm run gen-keys` (a Node script, so it also runs on Windows) and live in the gitignored `secrets/`.

## A-22 CI (part 1: checks job)

- **What runs and when.** `.github/workflows/ci.yml` runs on every push to any branch and on every PR to `main`: `npm ci`, lint, format check, typecheck, build, test. A PR can only be merged when it is green (branch protection → required status check "Lint, typecheck, build and test").
- **`npm ci`, not `npm install`.** `npm ci` installs exactly what `package-lock.json` says and fails if the lockfile is out of date, so CI tests the same dependency versions we use locally.
- **Same Node everywhere.** The Node version comes from `.nvmrc` (24), the same file developers use, and the npm cache makes repeat runs faster.
- **Security of the pipeline.** `permissions: contents: read` gives the workflow the least privilege it needs; no secrets are used. `concurrency` cancels an outdated run when a newer commit is pushed.
- **What comes next.** Integration tests need a real Postgres, so a Postgres service container is added together with the first schema (A-06); `docker build` steps are added once services have Dockerfiles (after A-04).

## A-06 auth_db schema and seed

- **Four tables.** `users`, a `roles` lookup table, `user_roles` (many-to-many, so a user can be `BIDDER` and `SELLER`), and `refresh_tokens`. Keys are UUIDs, times are `timestamptz`, and foreign keys `ON DELETE CASCADE` so deleting a user also removes their roles and tokens.
- **The database is the last line of defence.** Even if a bug skipped zod validation, Postgres still refuses: duplicate or non-lowercase emails, a password that is not an argon2id hash (so a plain-text password can never be stored), blank or over-long names, unknown statuses or roles, and a refresh token that is not a SHA-256 hex hash.
- **Why refresh tokens use SHA-256 but passwords use argon2id.** Passwords are short and guessable, so they need a slow, memory-hard hash. Refresh tokens are long random values, so a fast hash is enough; we only need that a stolen database cannot be used to log in. `family_id` and `replaced_by` support rotation: a reused old token lets A-07 revoke the whole family.
- **Deterministic seed.** Fixed version-4 UUIDs (other services' seeds can refer to the same users), fixed argon2id hashes, and `ON CONFLICT DO NOTHING`, so running it twice changes nothing. Demo accounts are listed at the top of `002_seed.sql`; the demo seller is the fallback for the Q1 demo step.
- **How it was verified.** Applied to a real Postgres, seed run twice, and 20 constraint cases tried (valid rows accepted, each invalid row rejected by the expected constraint). CI repeats the schema-plus-double-seed run on Postgres 16 on every push.

## A-04 Docker Compose base

- **What `docker compose up -d` starts.** Postgres 16, Redis 7 and RabbitMQ 4 (with the management UI), each with a health check, on one internal network `auction-backend`. `--wait` returns only when all three report healthy. Services and the gateway join later.
- **One Postgres, five databases.** `database/init-databases.sh` runs once when the data volume is empty: it creates `auth_db`, `auction_db`, `bidding_db`, `payment_db` and `notification_db` and applies each folder's SQL files in numeric order. This keeps "database per service" while running a single container. `docker compose down -v` deletes the volume, so the next start rebuilds and re-seeds everything.
- **Same script locally and in CI.** CI runs that exact script against a Postgres 16 container (and runs every seed twice), so a schema that works in CI works in Compose. CI also validates `docker-compose.yml` with `.env.example`.
- **Security and config choices.** Ports are bound to `127.0.0.1` only, so the database and broker are not reachable from the network. Passwords come from `.env` and Compose refuses to start if they are missing (`${VAR:?}`). The host port for Postgres is 5433, because 5432 is often taken by a locally installed Postgres.

## A-10 auction_db schema and seed

- **Tables.** `categories`, `auctions`, `auction_images` (URLs only, at most 10 per auction) and `processed_events`, which makes the event consumers in A-13 idempotent: an event ID is stored in the same transaction as its effect, so a redelivered event is skipped.
- **No foreign key to users.** `seller_id` and `winner_id` are user IDs from `auth_db`. Database per service means no cross-database foreign keys; the JWT tells us who the user is, and events tell us the result.
- **The state machine is protected twice.** The service layer enforces valid transitions (A-11), and the database refuses impossible rows: a sold auction without winner or price, a winner on an unsold auction, the seller as winner, a closed auction without `closed_at`, a published one without `published_at`. Money columns are `bigint` cents, so `10.50` is rejected outright.
- **Search and filters are indexed.** A generated `tsvector` column (English stemming, so "cameras" finds "camera") with a GIN index serves `?q=`; B-tree indexes cover status + end time, category, seller, price and creation date. The price filter uses the starting price, because the live highest bid belongs to bidding-service.
- **Seed for the demo.** Six categories and six auctions of the demo seller: two live, one upcoming, two drafts and one closed without sale. Times are relative to when the database is created, so a fresh start always has live auctions. Verified with 23 constraint cases on Postgres 16.
