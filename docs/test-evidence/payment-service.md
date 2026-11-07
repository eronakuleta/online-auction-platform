# Test evidence: payment-service (A-17 to A-19)

Generated from a real run of `npx jest --json` on 2026-11-07 19:09 UTC against the Docker Compose
PostgreSQL 16 (integration tests use a throwaway database built from the SQL files). Each row is
one test that ran; "Expected" is the behaviour the test asserts. Regenerate after changing tests
(the commands are at the top of `docs/test-evidence/generate.mjs`).

**Result: 76 of 76 passed.**

| ID      | Input                                                             | Expected                                                                             | Actual      | Pass/Fail |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- | --------- |
| PAY-001 | loadConfig (config.test.ts)                                       | reads a complete environment and converts numbers                                    | As expected | Pass      |
| PAY-002 | loadConfig (config.test.ts)                                       | fails fast, names every missing variable, and never prints a value                   | As expected | Pass      |
| PAY-003 | loadConfig (config.test.ts)                                       | needs only the public key                                                            | As expected | Pass      |
| PAY-004 | docs/api/payment.yaml (openapi.integration.test.ts)               | documents exactly the routes the code has, the internal funds check included         | As expected | Pass      |
| PAY-005 | docs/api/payment.yaml (openapi.integration.test.ts)               | GET /internal/funds-check exists in the running app                                  | As expected | Pass      |
| PAY-006 | docs/api/payment.yaml (openapi.integration.test.ts)               | GET /payments exists in the running app                                              | As expected | Pass      |
| PAY-007 | docs/api/payment.yaml (openapi.integration.test.ts)               | GET /wallet/me exists in the running app                                             | As expected | Pass      |
| PAY-008 | docs/api/payment.yaml (openapi.integration.test.ts)               | GET /wallet/transactions exists in the running app                                   | As expected | Pass      |
| PAY-009 | docs/api/payment.yaml (openapi.integration.test.ts)               | POST /wallet/deposit exists in the running app                                       | As expected | Pass      |
| PAY-010 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 10000 cents at 5% gives fee 500 and seller 9500                                      | As expected | Pass      |
| PAY-011 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 1999 cents at 5% gives fee 99 and seller 1900                                        | As expected | Pass      |
| PAY-012 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 19 cents at 5% gives fee 0 and seller 19                                             | As expected | Pass      |
| PAY-013 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 1 cents at 5% gives fee 0 and seller 1                                               | As expected | Pass      |
| PAY-014 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 12345 cents at 0% gives fee 0 and seller 12345                                       | As expected | Pass      |
| PAY-015 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 12345 cents at 100% gives fee 12345 and seller 0                                     | As expected | Pass      |
| PAY-016 | splitAmount (fee rounding, A-19) (settlement.integration.test.ts) | 9007199254740991 cents at 5% gives fee 450359962737049 and seller 8556839292003942   | As expected | Pass      |
| PAY-017 | consuming auction.closed (settlement.integration.test.ts)         | moves the money in one go and publishes payment.completed                            | As expected | Pass      |
| PAY-018 | consuming auction.closed (settlement.integration.test.ts)         | writes one ledger row per change, each with the balance after it                     | As expected | Pass      |
| PAY-019 | consuming auction.closed (settlement.integration.test.ts)         | writes no platform row when the fee rounds down to 0                                 | As expected | Pass      |
| PAY-020 | consuming auction.closed (settlement.integration.test.ts)         | accepts a balance of exactly the amount, leaving 0                                   | As expected | Pass      |
| PAY-021 | consuming auction.closed (settlement.integration.test.ts)         | moves nothing without enough money, records the failure and publishes payment.failed | As expected | Pass      |
| PAY-022 | consuming auction.closed (settlement.integration.test.ts)         | fails with WALLET_NOT_FOUND when the winner has no wallet                            | As expected | Pass      |
| PAY-023 | consuming auction.closed (settlement.integration.test.ts)         | pays a seller whose wallet did not exist yet, creating it                            | As expected | Pass      |
| PAY-024 | consuming auction.closed (settlement.integration.test.ts)         | settles at most once when the same event comes again (A-19)                          | As expected | Pass      |
| PAY-025 | consuming auction.closed (settlement.integration.test.ts)         | settles once when copies of the event arrive in parallel                             | As expected | Pass      |
| PAY-026 | consuming auction.closed (settlement.integration.test.ts)         | a failed payment is final: a replay cannot succeed later (A-19)                      | As expected | Pass      |
| PAY-027 | consuming auction.closed (settlement.integration.test.ts)         | settles different auctions of the same people in parallel without deadlock or loss   | As expected | Pass      |
| PAY-028 | consuming auction.closed (settlement.integration.test.ts)         | does nothing for an auction without a sale                                           | As expected | Pass      |
| PAY-029 | consuming auction.closed (settlement.integration.test.ts)         | keeps the settlement when the broker is down: the money has moved                    | As expected | Pass      |
| PAY-030 | consuming auction.closed (settlement.integration.test.ts)         | refuses another currency, so the event is retried and then dead-lettered             | As expected | Pass      |
| PAY-031 | consuming auction.closed (settlement.integration.test.ts)         | keeps every balance equal to the sum of its ledger rows                              | As expected | Pass      |
| PAY-032 | GET /payments (ADMIN) (settlement.integration.test.ts)            | lists every settlement, newest first, in the standard page shape                     | As expected | Pass      |
| PAY-033 | GET /payments (ADMIN) (settlement.integration.test.ts)            | filters by status                                                                    | As expected | Pass      |
| PAY-034 | GET /payments (ADMIN) (settlement.integration.test.ts)            | refuses ?status=PENDING with 400                                                     | As expected | Pass      |
| PAY-035 | GET /payments (ADMIN) (settlement.integration.test.ts)            | refuses ?size=101 with 400                                                           | As expected | Pass      |
| PAY-036 | GET /payments (ADMIN) (settlement.integration.test.ts)            | refuses ?page=0 with 400                                                             | As expected | Pass      |
| PAY-037 | GET /payments (ADMIN) (settlement.integration.test.ts)            | refuses ?auctionId=x with 400                                                        | As expected | Pass      |
| PAY-038 | GET /payments (ADMIN) (settlement.integration.test.ts)            | answers 401 without a token and 403 for bidders and sellers                          | As expected | Pass      |
| PAY-039 | GET /wallet/me (wallet.integration.test.ts)                       | shows the caller their own wallet                                                    | As expected | Pass      |
| PAY-040 | GET /wallet/me (wallet.integration.test.ts)                       | shows each user only their own wallet                                                | As expected | Pass      |
| PAY-041 | GET /wallet/me (wallet.integration.test.ts)                       | creates an empty wallet once when user.registered never arrived (Q11)                | As expected | Pass      |
| PAY-042 | GET /wallet/me (wallet.integration.test.ts)                       | answers 401 without a token and 403 for an admin-only account (Q13)                  | As expected | Pass      |
| PAY-043 | POST /wallet/deposit (wallet.integration.test.ts)                 | adds the amount and answers with the new balance and its ledger row                  | As expected | Pass      |
| PAY-044 | POST /wallet/deposit (wallet.integration.test.ts)                 | accepts exactly the limits: 1 cent and 10,000.00 (Q12)                               | As expected | Pass      |
| PAY-045 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is zero, and changes nothing                                  | As expected | Pass      |
| PAY-046 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is negative, and changes nothing                              | As expected | Pass      |
| PAY-047 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is a fraction of a cent, and changes nothing                  | As expected | Pass      |
| PAY-048 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is a string, and changes nothing                              | As expected | Pass      |
| PAY-049 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is over the limit, and changes nothing                        | As expected | Pass      |
| PAY-050 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is missing, and changes nothing                               | As expected | Pass      |
| PAY-051 | POST /wallet/deposit (wallet.integration.test.ts)                 | refuses an amount that is with an unknown field, and changes nothing                 | As expected | Pass      |
| PAY-052 | POST /wallet/deposit (wallet.integration.test.ts)                 | answers 401 without a token and 403 for an admin-only account                        | As expected | Pass      |
| PAY-053 | POST /wallet/deposit (wallet.integration.test.ts)                 | loses nothing under parallel deposits, and every row records its own balance         | As expected | Pass      |
| PAY-054 | POST /wallet/deposit (wallet.integration.test.ts)                 | dates a ledger row by when it got the lock, not when its transaction began           | As expected | Pass      |
| PAY-055 | GET /wallet/transactions (wallet.integration.test.ts)             | lists the caller own ledger, newest first, in the standard page shape                | As expected | Pass      |
| PAY-056 | GET /wallet/transactions (wallet.integration.test.ts)             | pages without repeating or skipping a row                                            | As expected | Pass      |
| PAY-057 | GET /wallet/transactions (wallet.integration.test.ts)             | never shows another user entries                                                     | As expected | Pass      |
| PAY-058 | GET /wallet/transactions (wallet.integration.test.ts)             | refuses ?size=101 with 400                                                           | As expected | Pass      |
| PAY-059 | GET /wallet/transactions (wallet.integration.test.ts)             | refuses ?page=0 with 400                                                             | As expected | Pass      |
| PAY-060 | GET /wallet/transactions (wallet.integration.test.ts)             | refuses ?size=abc with 400                                                           | As expected | Pass      |
| PAY-061 | GET /wallet/transactions (wallet.integration.test.ts)             | refuses ?sort=amount with 400                                                        | As expected | Pass      |
| PAY-062 | GET /wallet/transactions (wallet.integration.test.ts)             | answers 401 without a token and 403 for an admin-only account                        | As expected | Pass      |
| PAY-063 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | says whether the balance covers the amount, with the exact balance as the boundary   | As expected | Pass      |
| PAY-064 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | only reads: it never moves or holds money                                            | As expected | Pass      |
| PAY-065 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | answers 404 WALLET_NOT_FOUND for a user without a wallet, and does not create one    | As expected | Pass      |
| PAY-066 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | cannot be used to read the platform wallet                                           | As expected | Pass      |
| PAY-067 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses a bad user ID with 400                                                       | As expected | Pass      |
| PAY-068 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses a zero amount with 400                                                       | As expected | Pass      |
| PAY-069 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses a fractional amount with 400                                                 | As expected | Pass      |
| PAY-070 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses a text amount with 400                                                       | As expected | Pass      |
| PAY-071 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses no amount with 400                                                           | As expected | Pass      |
| PAY-072 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | refuses an unknown parameter with 400                                                | As expected | Pass      |
| PAY-073 | GET /internal/funds-check (Q10) (wallet.integration.test.ts)      | is not part of the public API                                                        | As expected | Pass      |
| PAY-074 | consuming user.registered (wallet.integration.test.ts)            | creates an empty wallet in the platform currency                                     | As expected | Pass      |
| PAY-075 | consuming user.registered (wallet.integration.test.ts)            | changes nothing when the event is delivered again, even in parallel                  | As expected | Pass      |
| PAY-076 | the ledger explains every balance (wallet.integration.test.ts)    | balance equals the sum of ledger rows for every wallet, after all the tests above    | As expected | Pass      |
