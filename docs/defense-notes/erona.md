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

## A-05 Shared auth (part 2: Express middleware)

- **`authenticate(verifyToken)`** reads the `Authorization: Bearer` header, verifies the token and sets `req.user`. Any bad token gets the same 401 "Authentication required", so an attacker cannot tell an expired token from a forged one.
- **`requireRole('SELLER', 'ADMIN')`** runs after `authenticate()` and gives 403 unless the user has at least one of the roles. So no token is 401 ("who are you?") and the wrong role is 403 ("I know you, but no").
- **It fails closed.** If someone forgets `authenticate()` on a route, `requireRole()` answers 401 instead of letting the request through. `requireRole()` with no roles crashes at startup, so a route can never be accidentally open.
- **Unexpected errors stay 500.** Only `TokenVerificationError` becomes a 401, so a bug in the verifier is logged and not hidden as "bad token".
- **Reuse, not duplication.** The middleware throws Anesa's `UnauthorizedError` and `ForbiddenError` (B-02), and her error handler produces the standard body with the `requestId`. 14 Supertest tests cover this through a real Express app.

## A-16 payment_db schema and seed

- **Three tables.** `wallets` (one per user, plus exactly one `PLATFORM` wallet for fees), `settlements` (one per auction) and `ledger_entries` (one row per balance change, so every balance can be explained and recomputed).
- **The database refuses to lose money.** `balance_cents >= 0` makes overspending impossible even with a bug in the service, `fee_cents + seller_cents = amount_cents` means a split can never lose or create a cent, and all amounts are `bigint` cents, so decimals are rejected.
- **Idempotency through natural keys.** `UNIQUE (auction_id)` on settlements makes a replayed `auction.closed` do nothing, and `UNIQUE (user_id)` on wallets does the same for `user.registered`. So this database needs no `processed_events` table.
- **Failed payments are stored too.** A `FAILED` row also takes the auction's one settlement slot. Otherwise a replay could succeed after a deposit and contradict the `payment.failed` event already sent.
- **Seed and proof.** Wallets for all demo users, with a `DEPOSIT` ledger row behind every starting balance. Verified on Postgres 16 with 25 valid and invalid cases, plus one full settlement (debit, seller credit, fee).

## A-07 auth-service

- **Layers, in the order a request travels.** `routes` (wiring and which endpoints need a token), `controllers` (zod parse, shape the response), `services` (the rules, no Express, no SQL), `repositories` (the only place with SQL, always `$1` parameters). This is the template for the other services.
- **Login reveals nothing.** A wrong password, an unknown email and a banned user all get the same 401 "Invalid credentials". For an unknown email we still run argon2 against a dummy hash, so response time does not reveal which emails exist.
- **Refresh token rotation.** A refresh token is 256 random bits, stored only as a SHA-256 hash, and works once. Each refresh replaces it within the same `family_id`. If a used token comes back it may be stolen, so the whole family is revoked and that session must log in again. `logout` revokes one family, so other devices stay logged in.
- **Why `FOR UPDATE`.** Two parallel refreshes with one token must not both succeed, so the row is locked until the transaction ends. A deterministic test proves it: another transaction holds the row and commits a "used" mark while the refresh waits. Removing `FOR UPDATE` makes that test fail (a wrong 200 instead of 401), which we checked; our first, simpler parallel test did not catch it.
- **Decisions Q1 and Q2 are enforced by strict schemas.** `z.strictObject` rejects unknown fields, so `roles: ["ADMIN"]` on register or profile update is a 400. New roles reach the token at the next refresh, because the refresh rereads them from the database.
- **Running it.** Multi-stage Docker image without dev dependencies, as a non-root user. Only this service mounts the private key. Tests use a real Postgres with a throwaway database per test file, built from the same SQL files, and even check that the seeded demo password logs in.

## A-08 Admin endpoints and `user.registered`

- **Three admin endpoints behind `requireRole('ADMIN')`.** `GET /users` (paginated, filter by status), `PATCH /users/:id/status` (ban or unban) and `PATCH /users/:id/roles`. A bidder gets 403 and no token gets 401, so a bidder cannot promote themselves, and this is the only way to become a `SELLER` (Q1).
- **Banning is immediate for sessions, not for access tokens.** The status change and the revocation of all refresh tokens happen in one transaction, so login and refresh stop at once. An access token already issued works until it expires, at most 15 minutes, because services verify tokens without calling auth-service. That is the known trade-off of stateless JWTs.
- **`user.registered` is published after the commit.** It goes to the payment queue (wallet) and the notification queue (welcome), and carries no email, so the address stays in `auth_db`. If the broker fails, the account exists, so we still answer 201 and log the error. That lost event is the limitation in `docs/events.md`; a transactional outbox would solve it and is a stretch goal.
- **Admin accounts are protected (Q6).** The roadmap says ADMIN is seeded, so the API cannot grant `ADMIN`, ban an admin or change an admin's roles. That also rules out locking everyone out of admin. Row locks (`FOR UPDATE`) make parallel changes to one user run in turn.
- **A real bug that testing found.** A concurrency test failed once in many runs. The cause was `revoked_at = now()`: `now()` is when the transaction _started_, so a transaction that waited on a lock could date a revocation before the token was created, which breaks a CHECK and gives a 500. The fix is `clock_timestamp()`, the actual current time. A deterministic test now covers it and fails if the bug comes back. Good answer to "what was hard?".

## A-11 Auction lifecycle

- **Two checks, in two places.** `requireRole('SELLER')` in the route answers "may this kind of user do this?". "Is this _your_ auction?" needs the database, so the service layer checks it. Admins can cancel any auction, but only the seller can edit, publish or delete it.
- **404 or 403?** If you may not even know the auction exists (someone else's draft), you get 404, as with decision Q4. If it is public (published), you get a 403, because hiding it would be pointless. A draft that was cancelled stays hidden, because it was never public.
- **State rules live in the service, and the database backs them up.** Edit and delete only in `DRAFT`, publish only from `DRAFT`, cancel only from `DRAFT` or `PUBLISHED`. Each change locks the row with `FOR UPDATE`, so five parallel publishes give one 200 and four 409s. A published auction cannot be edited at all, so bidding's copy of its terms can never go stale.
- **Cancel is the interesting one.** "Only before the first bid" spans two databases, so for a published auction we ask bidding-service, which decides under the same row lock as place-bid. The call happens _before_ our transaction, so no lock is held during a network call (a test proves it). Afterwards we recheck the status, because the auction may have changed meanwhile, and answer `409 AUCTION_STATE_CHANGED`. If bidding cannot answer within 2 s we answer 503 and change nothing.
- **What is left to other tasks.** Publishing the `auction.published` and `auction.cancelled` events is task A-13, and bidding-service's real cancel endpoint is B-06. Tests use a real HTTP server that follows the contract in `docs/events.md` section 8. We also broke 18 rules on purpose (for example, removing the ownership check) and confirmed the tests catch each one.

## A-12 Catalog: list, search, filter, sort, paginate

- **One endpoint, `GET /auctions`.** Search (`q`), category, status, price range, five sort orders, and pages in the standard `{ data, page, size, total }` shape. Drafts are never listed, and reserve prices appear only on the caller's own auctions.
- **SQL injection is impossible by construction.** The WHERE clause is built only from fixed text fragments, and every value goes in as a `$n` parameter. The sort column comes from a fixed map, never from the request. A test sends `sort=id; DROP TABLE auctions` and gets a 400.
- **Search uses Postgres full text, not `LIKE`.** A generated `tsvector` column with a GIN index, English stemming ("cameras" finds "camera"), and `websearch_to_tsquery`, which understands "quotes", `OR` and `-word` and never fails on odd input. Ranking uses `ts_rank_cd`.
- **Stable paging.** Every sort ends with `id`, so two auctions with the same price always come in the same order, and moving through pages never repeats or skips one. A test checks this.
- **Indexes from measurements, not guesses.** With 100,000 auctions, the default "newest first" page took 32 ms because Postgres sorted all 30,003 published rows. A new `(status, published_at DESC, id)` index made it 0.26 ms (13 ms to 0.13 ms within one category). A price index was also tried and dropped, because the existing one was already enough. The change is in a new file, `003_catalog_indexes.sql`, never in `001_schema.sql`.
- **Tests that can fail.** 42 listing tests. We broke 14 rules on purpose; the first run caught 12, and the 2 misses showed weak tests (equal prices, and a ranking test that happened to match "newest first"). After fixing them, all 14 are caught.
