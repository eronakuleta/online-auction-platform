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
