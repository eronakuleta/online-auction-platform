# Security tests and audit

Owner: Erona (task A-23). Hardening covers what exists today: the gateway, auth-service,
auction-service and payment-service (joined in A-17). Anesa's services reuse the same pieces when
they are built: helmet in the app, routing through the gateway, and new rows in the RBAC matrix below.

## What is in place

| Measure                                          | Where                                                                                   | How it is checked                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Input validation, unknown fields rejected        | zod `strictObject` in every service                                                     | service integration tests                         |
| SQL only with `$n` parameters                    | every repository                                                                        | SQL injection payloads below                      |
| JWT RS256; only auth-service has the private key | `@auction/shared-auth`, Compose mounts                                                  | JWT tests below; audit item 7                     |
| Roles in routes, ownership in services           | `requireRole()`, service layer                                                          | RBAC matrix below                                 |
| Security headers                                 | `helmet` in each service (no HSTS on localhost)                                         | header tests below                                |
| CORS allow-list                                  | gateway, from `CORS_ALLOWED_ORIGINS`                                                    | CORS tests below                                  |
| Body size limits                                 | 10 kB auth, 64 kB auction, 100 kB gateway                                               | service tests, gateway smoke test                 |
| Rate limits per IP                               | gateway (stricter for `/auth`)                                                          | gateway smoke test                                |
| Login throttling per account                     | auth-service: 5 failures lock the account for 5 minutes, same generic 401 (decision Q9) | `login-throttling.integration.test.ts`            |
| `/internal` not reachable from outside           | gateway                                                                                 | gateway smoke test                                |
| HTTPS                                            | gateway, self-signed locally                                                            | gateway smoke test; limits in `gateway/README.md` |
| Generic errors, no stack traces                  | shared error handler                                                                    | header tests below                                |

## Run

With the stack started (`docker compose up -d --build --wait`):

```bash
NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:security
```

`security.e2e.mjs` runs through the gateway with the seeded demo accounts. It needs no packages
(tokens are built with `node:crypto`). A `429` from the gateway is waited out instead of failing,
so it can run right after the smoke test. CI runs both in the "Gateway smoke test" job.

| Group         | What it proves                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT           | No token, garbage, expired, forged (other key), `alg: none`, HS256 signed with the public key, wrong issuer, wrong audience, unknown role, no roles, and a real token edited to `ADMIN`: all get the same `401`. A token signed with the real key is accepted, so the suite is not refusing everything. |
| RBAC matrix   | 14 endpoints (3 of them the wallet) × visitor, bidder, seller, admin, with the exact expected status for each, plus one ownership case (another seller's draft is a 404).                                                                                                                               |
| SQL injection | 7 payloads (`' OR '1'='1`, `DROP TABLE`, `UNION SELECT`, `pg_sleep`, ...) in search, sort, filters, IDs, the admin user filter and login. Search treats them as words, everything else gives `400`, `pg_sleep` never runs, and nothing is dropped.                                                      |
| CORS          | The frontend origin may read answers, including gateway errors; preflights work; other origins (including `http://localhost:5173.evil.test` and `null`) get nothing; credentials are never allowed.                                                                                                     |
| Headers       | `nosniff`, `X-Frame-Options`, CSP, no `X-Powered-By`, no HSTS, no stack trace in a 503.                                                                                                                                                                                                                 |

**Do the tests catch real holes?** We planted two on purpose and reran the suite (06.11.2026):

| Planted hole                                                         | Result                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| The search term pasted into the SQL text instead of a `$n` parameter | 4 SQL injection tests failed (a lone `'` gave a 500) |
| The gateway allowing every origin                                    | The CORS "other origins" test failed                 |

Both were removed again, and the suite passed 37 of 37.

## Secrets audit (06.11.2026)

| #   | Check                                                                                           | Result                                                                                      |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Tracked files that look secret (`.env`, `*.pem`, keys, `secrets/`, `certs/`)                    | none                                                                                        |
| 2   | Private keys anywhere in the Git history of all branches                                        | none                                                                                        |
| 3   | JWT-looking strings in the history                                                              | one: a deliberately fake test token (payload `{"sub":"1"}`, signature the word "signature") |
| 4   | Password, secret or token assignments in the history                                            | only test variable names and documented placeholders (`change-me-...`, demo accounts)       |
| 5   | `.gitignore` covers `.env`, `secrets/`, `gateway/certs/`, `coverage/`, `node_modules/`, `dist/` | yes                                                                                         |
| 6   | Secrets inside the Docker images                                                                | none; the gateway image only has Alpine's public CA bundle                                  |
| 7   | Which containers can read the JWT private key                                                   | only auth-service; auction-service has the public key, the gateway neither                  |
| 8   | Tokens, passwords, hashes or placeholders in the running stack's logs                           | none                                                                                        |

**Accepted and documented:** the demo accounts' passwords are written in `database/auth/002_seed.sql`.
They exist only for local development and the demo, and the repository is public, so they must
never be used anywhere real. `.env.example` holds placeholder values only (`change-me-...`).

## Known limits

- A banned user's access token stays valid until it expires (at most 15 minutes), because services
  verify tokens without asking auth-service.
- Account locking can be abused to lock out a known user for 5 minutes at a time (decision Q9 keeps
  the lock short, and failures during a lock do not extend it).
- Rate limits are per IP, so many users behind one NAT share a limit.
