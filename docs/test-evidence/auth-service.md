# Test evidence: auth-service (A-09)

Generated from a real run of `npx jest --json` on 2026-11-06 21:57 UTC against the Docker Compose
PostgreSQL 16 (integration tests use a throwaway database built from the SQL files). Each row is
one test that ran; "Expected" is the behaviour the test asserts. Regenerate after changing tests
(the commands are at the top of `docs/test-evidence/generate.mjs`).

**Result: 119 of 119 passed.**

| ID       | Input                                                               | Expected                                                                               | Actual      | Pass/Fail |
| -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- | --------- |
| AUTH-001 | user.registered event (admin.integration.test.ts)                   | is published after registration with the contract payload and no email                 | As expected | Pass      |
| AUTH-002 | user.registered event (admin.integration.test.ts)                   | is not published when the email is taken                                               | As expected | Pass      |
| AUTH-003 | user.registered event (admin.integration.test.ts)                   | still answers 201 and keeps the account if the broker fails                            | As expected | Pass      |
| AUTH-004 | GET /users (admin.integration.test.ts)                              | returns the standard page shape without password hashes                                | As expected | Pass      |
| AUTH-005 | GET /users (admin.integration.test.ts)                              | uses page 1 and size 20 by default                                                     | As expected | Pass      |
| AUTH-006 | GET /users (admin.integration.test.ts)                              | pages through users without repeats, whatever the page size                            | As expected | Pass      |
| AUTH-007 | GET /users (admin.integration.test.ts)                              | returns an empty page past the end, with the right total                               | As expected | Pass      |
| AUTH-008 | GET /users (admin.integration.test.ts)                              | filters by status                                                                      | As expected | Pass      |
| AUTH-009 | GET /users (admin.integration.test.ts)                              | answers 400 for size above 100                                                         | As expected | Pass      |
| AUTH-010 | GET /users (admin.integration.test.ts)                              | answers 400 for size 0                                                                 | As expected | Pass      |
| AUTH-011 | GET /users (admin.integration.test.ts)                              | answers 400 for page 0                                                                 | As expected | Pass      |
| AUTH-012 | GET /users (admin.integration.test.ts)                              | answers 400 for a page that is not a number                                            | As expected | Pass      |
| AUTH-013 | GET /users (admin.integration.test.ts)                              | answers 400 for a decimal page                                                         | As expected | Pass      |
| AUTH-014 | GET /users (admin.integration.test.ts)                              | answers 400 for an unknown status                                                      | As expected | Pass      |
| AUTH-015 | GET /users (admin.integration.test.ts)                              | answers 400 for an unknown parameter                                                   | As expected | Pass      |
| AUTH-016 | GET /users (admin.integration.test.ts)                              | answers 400 for SQL in a parameter                                                     | As expected | Pass      |
| AUTH-017 | GET /users (admin.integration.test.ts)                              | answers 401 without a token and 403 for a non-admin                                    | As expected | Pass      |
| AUTH-018 | PATCH /users/:id/status (admin.integration.test.ts)                 | bans: login and refresh stop working, everywhere                                       | As expected | Pass      |
| AUTH-019 | PATCH /users/:id/status (admin.integration.test.ts)                 | unbans: the user can log in again, but old sessions stay ended                         | As expected | Pass      |
| AUTH-020 | PATCH /users/:id/status (admin.integration.test.ts)                 | can be repeated with the same status                                                   | As expected | Pass      |
| AUTH-021 | PATCH /users/:id/status (admin.integration.test.ts)                 | refuses to ban an admin (Q6), including yourself                                       | As expected | Pass      |
| AUTH-022 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 400 for an unknown status                                                      | As expected | Pass      |
| AUTH-023 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 400 for no status                                                              | As expected | Pass      |
| AUTH-024 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 400 for an extra field                                                         | As expected | Pass      |
| AUTH-025 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 400 for an ID that is not a UUID                                               | As expected | Pass      |
| AUTH-026 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 404 for an unknown user                                                        | As expected | Pass      |
| AUTH-027 | PATCH /users/:id/status (admin.integration.test.ts)                 | answers 401 without a token and 403 for a non-admin, and changes nothing               | As expected | Pass      |
| AUTH-028 | PATCH /users/:id/roles (admin.integration.test.ts)                  | grants SELLER, which reaches the token at the next refresh (Q1)                        | As expected | Pass      |
| AUTH-029 | PATCH /users/:id/roles (admin.integration.test.ts)                  | replaces the whole list: a role left out is removed                                    | As expected | Pass      |
| AUTH-030 | PATCH /users/:id/roles (admin.integration.test.ts)                  | keeps sessions alive, unlike a ban                                                     | As expected | Pass      |
| AUTH-031 | PATCH /users/:id/roles (admin.integration.test.ts)                  | applies parallel changes one at a time, ending in one of the requested lists           | As expected | Pass      |
| AUTH-032 | PATCH /users/:id/roles (admin.integration.test.ts)                  | refuses to change an admin (Q6)                                                        | As expected | Pass      |
| AUTH-033 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for granting ADMIN (Q6)                                                    | As expected | Pass      |
| AUTH-034 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for an unknown role                                                        | As expected | Pass      |
| AUTH-035 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for an empty list                                                          | As expected | Pass      |
| AUTH-036 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for a repeated role                                                        | As expected | Pass      |
| AUTH-037 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for something that is not a list                                           | As expected | Pass      |
| AUTH-038 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for an extra field                                                         | As expected | Pass      |
| AUTH-039 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 400 for a bad ID and 404 for an unknown user                                   | As expected | Pass      |
| AUTH-040 | PATCH /users/:id/roles (admin.integration.test.ts)                  | answers 401 without a token and 403 for a non-admin                                    | As expected | Pass      |
| AUTH-041 | PATCH /users/:id/roles (admin.integration.test.ts)                  | stops a bidder from promoting themselves                                               | As expected | Pass      |
| AUTH-042 | POST /auth/register (auth.integration.test.ts)                      | creates a BIDDER and never returns the password hash                                   | As expected | Pass      |
| AUTH-043 | POST /auth/register (auth.integration.test.ts)                      | stores an argon2id hash, not the password                                              | As expected | Pass      |
| AUTH-044 | POST /auth/register (auth.integration.test.ts)                      | normalises the email                                                                   | As expected | Pass      |
| AUTH-045 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for an invalid email                                                       | As expected | Pass      |
| AUTH-046 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a short password                                                       | As expected | Pass      |
| AUTH-047 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a password over 128 characters                                         | As expected | Pass      |
| AUTH-048 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a blank display name                                                   | As expected | Pass      |
| AUTH-049 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a display name over 100 characters                                     | As expected | Pass      |
| AUTH-050 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a NUL character in the display name                                    | As expected | Pass      |
| AUTH-051 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a line break in the display name                                       | As expected | Pass      |
| AUTH-052 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for an escape code in the display name                                     | As expected | Pass      |
| AUTH-053 | POST /auth/register (auth.integration.test.ts)                      | accepts letters from any language and emoji in the display name                        | As expected | Pass      |
| AUTH-054 | POST /auth/register (auth.integration.test.ts)                      | accepts exactly 100 characters, and 128 for the password                               | As expected | Pass      |
| AUTH-055 | POST /auth/register (auth.integration.test.ts)                      | answers 400 with the field name for a missing field                                    | As expected | Pass      |
| AUTH-056 | POST /auth/register (auth.integration.test.ts)                      | rejects a roles field, so nobody can make themselves a seller (Q1)                     | As expected | Pass      |
| AUTH-057 | POST /auth/register (auth.integration.test.ts)                      | answers 400 for a body that is not JSON                                                | As expected | Pass      |
| AUTH-058 | POST /auth/register (auth.integration.test.ts)                      | answers 413 for an oversized body                                                      | As expected | Pass      |
| AUTH-059 | POST /auth/register (auth.integration.test.ts)                      | answers 409 for a taken email, also in another case                                    | As expected | Pass      |
| AUTH-060 | POST /auth/register (auth.integration.test.ts)                      | lets only one of two parallel registrations with one email succeed                     | As expected | Pass      |
| AUTH-061 | POST /auth/register (auth.integration.test.ts)                      | treats SQL in a field as plain text                                                    | As expected | Pass      |
| AUTH-062 | POST /auth/login (auth.integration.test.ts)                         | returns tokens with the right claims                                                   | As expected | Pass      |
| AUTH-063 | POST /auth/login (auth.integration.test.ts)                         | logs in the seeded demo seller with the password from the seed file                    | As expected | Pass      |
| AUTH-064 | POST /auth/login (auth.integration.test.ts)                         | stores only the hash of the refresh token                                              | As expected | Pass      |
| AUTH-065 | POST /auth/login (auth.integration.test.ts)                         | gives the same answer for a wrong password, an unknown email and a banned user         | As expected | Pass      |
| AUTH-066 | POST /auth/login (auth.integration.test.ts)                         | answers 400 for no email                                                               | As expected | Pass      |
| AUTH-067 | POST /auth/login (auth.integration.test.ts)                         | answers 400 for no password                                                            | As expected | Pass      |
| AUTH-068 | POST /auth/login (auth.integration.test.ts)                         | answers 400 for an extra field                                                         | As expected | Pass      |
| AUTH-069 | POST /auth/login (auth.integration.test.ts)                         | answers 400 for an object as password                                                  | As expected | Pass      |
| AUTH-070 | POST /auth/refresh (auth.integration.test.ts)                       | rotates: returns a new pair that works                                                 | As expected | Pass      |
| AUTH-071 | POST /auth/refresh (auth.integration.test.ts)                       | revokes the whole family when a used token comes back                                  | As expected | Pass      |
| AUTH-072 | POST /auth/refresh (auth.integration.test.ts)                       | lets at most one of many parallel refreshes with one token succeed                     | As expected | Pass      |
| AUTH-073 | POST /auth/refresh (auth.integration.test.ts)                       | waits for the row lock, so a refresh in progress cannot be overtaken                   | As expected | Pass      |
| AUTH-074 | POST /auth/refresh (auth.integration.test.ts)                       | can revoke a token created after the revoking transaction started                      | As expected | Pass      |
| AUTH-075 | POST /auth/refresh (auth.integration.test.ts)                       | refuses an expired token                                                               | As expected | Pass      |
| AUTH-076 | POST /auth/refresh (auth.integration.test.ts)                       | refuses a banned user and revokes the family                                           | As expected | Pass      |
| AUTH-077 | POST /auth/refresh (auth.integration.test.ts)                       | puts the current roles in the new access token                                         | As expected | Pass      |
| AUTH-078 | POST /auth/refresh (auth.integration.test.ts)                       | answers 401 for an unknown token and 400 for no token                                  | As expected | Pass      |
| AUTH-079 | POST /auth/logout (auth.integration.test.ts)                        | answers 204 and the token stops working                                                | As expected | Pass      |
| AUTH-080 | POST /auth/logout (auth.integration.test.ts)                        | revokes later tokens of the same session                                               | As expected | Pass      |
| AUTH-081 | POST /auth/logout (auth.integration.test.ts)                        | does not end the sessions on other devices                                             | As expected | Pass      |
| AUTH-082 | POST /auth/logout (auth.integration.test.ts)                        | answers 204 for an unknown token, revealing nothing                                    | As expected | Pass      |
| AUTH-083 | POST /auth/logout (auth.integration.test.ts)                        | answers 400 for no token                                                               | As expected | Pass      |
| AUTH-084 | /users/me (auth.integration.test.ts)                                | GET returns the caller                                                                 | As expected | Pass      |
| AUTH-085 | /users/me (auth.integration.test.ts)                                | GET answers 401 without a token, with a bad token, and with a refresh token            | As expected | Pass      |
| AUTH-086 | /users/me (auth.integration.test.ts)                                | GET answers 404 if the user no longer exists                                           | As expected | Pass      |
| AUTH-087 | /users/me (auth.integration.test.ts)                                | PATCH changes the display name                                                         | As expected | Pass      |
| AUTH-088 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for email (Q2)                                                       | As expected | Pass      |
| AUTH-089 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for roles (Q2)                                                       | As expected | Pass      |
| AUTH-090 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for status (Q2)                                                      | As expected | Pass      |
| AUTH-091 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for password (Q2)                                                    | As expected | Pass      |
| AUTH-092 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for a blank display name (Q2)                                        | As expected | Pass      |
| AUTH-093 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for a NUL character (Q2)                                             | As expected | Pass      |
| AUTH-094 | /users/me (auth.integration.test.ts)                                | PATCH answers 400 for an empty body (Q2)                                               | As expected | Pass      |
| AUTH-095 | /users/me (auth.integration.test.ts)                                | PATCH answers 404 if the user no longer exists, and creates nothing                    | As expected | Pass      |
| AUTH-096 | /users/me (auth.integration.test.ts)                                | PATCH answers 401 without a token                                                      | As expected | Pass      |
| AUTH-097 | other routes (auth.integration.test.ts)                             | GET /health answers 200 when the database is reachable                                 | As expected | Pass      |
| AUTH-098 | other routes (auth.integration.test.ts)                             | answers the standard 404 for an unknown route                                          | As expected | Pass      |
| AUTH-099 | loadConfig (config.test.ts)                                         | reads a complete environment and converts numbers                                      | As expected | Pass      |
| AUTH-100 | loadConfig (config.test.ts)                                         | fails fast and names every missing variable                                            | As expected | Pass      |
| AUTH-101 | loadConfig (config.test.ts)                                         | rejects a port that is not a number, without printing values                           | As expected | Pass      |
| AUTH-102 | per-account login throttling (login-throttling.integration.test.ts) | locks the account after 5 failures: even the right password then gets the same 401     | As expected | Pass      |
| AUTH-103 | per-account login throttling (login-throttling.integration.test.ts) | allows one attempt fewer than the limit                                                | As expected | Pass      |
| AUTH-104 | per-account login throttling (login-throttling.integration.test.ts) | lets the user in again once the lock has expired, and starts counting from zero        | As expected | Pass      |
| AUTH-105 | per-account login throttling (login-throttling.integration.test.ts) | resets the count on a successful login                                                 | As expected | Pass      |
| AUTH-106 | per-account login throttling (login-throttling.integration.test.ts) | does not extend the lock with more wrong guesses during it                             | As expected | Pass      |
| AUTH-107 | per-account login throttling (login-throttling.integration.test.ts) | counts parallel failures correctly and locks the account                               | As expected | Pass      |
| AUTH-108 | per-account login throttling (login-throttling.integration.test.ts) | locks only the attacked account, not others                                            | As expected | Pass      |
| AUTH-109 | per-account login throttling (login-throttling.integration.test.ts) | gives an unknown email the same answer, and stores nothing for it                      | As expected | Pass      |
| AUTH-110 | per-account login throttling (login-throttling.integration.test.ts) | keeps refresh working for a session started before the lock                            | As expected | Pass      |
| AUTH-111 | hashPassword (passwords.test.ts)                                    | produces an argon2id hash that does not contain the password                           | As expected | Pass      |
| AUTH-112 | hashPassword (passwords.test.ts)                                    | salts every hash, so the same password never gives the same hash twice                 | As expected | Pass      |
| AUTH-113 | passwordMatches (passwords.test.ts)                                 | accepts the right password and refuses a wrong one                                     | As expected | Pass      |
| AUTH-114 | passwordMatches (passwords.test.ts)                                 | refuses every password when there is no user, but still does the slow check            | As expected | Pass      |
| AUTH-115 | access tokens (tokens.test.ts)                                      | are RS256 tokens with the user, roles, issuer, audience and a 15-minute lifetime       | As expected | Pass      |
| AUTH-116 | access tokens (tokens.test.ts)                                      | are accepted by the shared verifier that the other services use                        | As expected | Pass      |
| AUTH-117 | access tokens (tokens.test.ts)                                      | are refused when signed with another key, or meant for another audience                | As expected | Pass      |
| AUTH-118 | refresh tokens (tokens.test.ts)                                     | are 256 random bits, URL-safe, and never repeat                                        | As expected | Pass      |
| AUTH-119 | refresh tokens (tokens.test.ts)                                     | are stored as a SHA-256 hash: the same token always gives the same hash, others differ | As expected | Pass      |
