# Test report — 9 November 2026

Tests below were actually executed during the takeover on Windows, Node 24.15.0 and Docker Desktop Linux containers: PostgreSQL 16, Redis 7 and RabbitMQ 4. Integration tests create isolated real databases from the production SQL. Broker-helper tests used a separate broker on port 5673 because they purge their queues. Gateway tests used the application broker and both bidding replicas.

## Executed evidence

| ID                       | Input                                                                                          | Expected                                                        | Actual                                                          | Pass/Fail |
| ------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| UNIT-AUTH-SHARED         | JWT validation and role middleware suite                                                       | All tests pass                                                  | 48 passed                                                       | Pass      |
| UNIT-COMMON              | Logger, errors, events, metrics and isolated real broker tests                                 | All tests pass, including retry/DLQ                             | 95 passed, none skipped                                         | Pass      |
| INTEGRATION-AUCTION      | CRUD, ownership, catalog, state/events, categories, OpenAPI against real Postgres              | All tests pass                                                  | 265 passed                                                      | Pass      |
| INTEGRATION-AUTH         | Passwords, refresh rotation, profile, users, throttling and OpenAPI against real Postgres      | All tests pass                                                  | 129 passed                                                      | Pass      |
| INTEGRATION-BIDDING      | Rules, 50 parallel bidders, closing, cache, two-replica SSE, idempotency, config and OpenAPI   | All tests pass with real Postgres and Redis                     | 156 passed, none skipped                                        | Pass      |
| INTEGRATION-NOTIFICATION | Builders, DB constraints, duplicate/parallel events, ownership, API and OpenAPI                | All tests pass                                                  | 85 passed                                                       | Pass      |
| INTEGRATION-PAYMENT      | Wallet, settlement, duplicate events, insufficient funds and exact fee rounding                | All tests pass                                                  | 76 passed                                                       | Pass      |
| FRONTEND                 | State versions, countdown, bid standing and bidder labels                                      | All helper tests pass                                           | 19 passed                                                       | Pass      |
| GATEWAY                  | TLS, routing, internal-path blocking, rate limits, SSE, notification routing                   | All smoke tests pass                                            | 16 passed                                                       | Pass      |
| SECURITY                 | JWT attacks, SQL injection, RBAC including notifications, CORS, headers and dependency failure | All security tests pass                                         | 49 passed                                                       | Pass      |
| EVENTS                   | Real publish, consume and out-of-order payment                                                 | All tests pass                                                  | 3 passed                                                        | Pass      |
| WALLET                   | Registration event, deposit/history, funds check and gateway blocking                          | All tests pass                                                  | 4 passed                                                        | Pass      |
| SETTLEMENT               | Successful sale and payment failure on real broker                                             | Correct balances and catalog state                              | 2 passed                                                        | Pass      |
| LIFECYCLE                | Register, publish, bid, natural close, sale/no-sale, settle and notify                         | Consistent money, winner and notifications                      | 1 passed                                                        | Pass      |
| REPLICAS                 | Gateway distribution and cross-replica SSE                                                     | Both replicas respond and stream receives other replica's bids  | 2 passed                                                        | Pass      |
| METRICS                  | Internal health/metrics on every service and gateway isolation                                 | Metrics include HTTP/process counters; gateway rejects /metrics | 6 passed                                                        | Pass      |
| API-COLLECTION           | Valid, invalid, boundary and unauthorized requests across all services                         | Expected status and standard errors                             | 29 passed; [actual requests/results](api-collection-results.md) | Pass      |
| FRESH-DATABASE           | New isolated Postgres, all schema files and every seed twice via RERUN_SEEDS=1                 | Five databases initialize without SQL errors                    | Init completed and Postgres became ready                        | Pass      |
| PROMETHEUS               | Real /api/v1/targets response                                                                  | Five services plus second bidding replica up                    | Six targets up, empty lastError                                 | Pass      |
| TYPES-BUILD              | npm run typecheck and npm run build                                                            | All workspaces compile, frontend builds                         | Passed; Vite reports its existing large-bundle advisory         | Pass      |

Workspace total: **854 backend + 19 frontend = 873 passed, none skipped**. Stack suites add **83 passed**, and the API collection adds **29 passed**. These are separate executions and may cover overlapping behavior. Load-test checks are reported separately in [the performance report](performance-report.md).

Run the documented commands in the root README to reproduce. CI also runs the broker helper suite on its own service container, so it need not skip those cases. Existing per-test reports in `docs/test-evidence` document the earlier auth/auction/payment/notification runs; the totals above are the current rerun and include new coverage.

## Failures found and corrected during verification

The legacy local notification database was empty, which produced a real 500 in the smoke test. Its missing schema/seed was applied without resetting other databases, and startup gained that specific upgrade path. Repeated smoke runs also exposed a test assumption about an unused rate-limit budget; the test now waits until an invalid login reaches auth before testing the burst. OpenAPI coverage initially rejected quoted YAML path keys; the parser now handles both quoted and unquoted paths. Each affected check was rerun successfully. Failed load attempts and their fixes are retained in the performance evidence.

## Human review boundary

This report verifies software behavior, not that either student has rehearsed or approved a PR. A-30/B-24 and A-31/B-25 retain their student rehearsal and peer-approval steps. The takeover audit and AI disclosure describe exactly which work was automated.
