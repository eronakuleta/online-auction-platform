# Test evidence: notification-service (B-14 to B-16)

Generated from a real run of `npx jest --json` on 2026-11-08 17:09 UTC against the Docker Compose
PostgreSQL 16 (integration tests use a throwaway database built from the SQL files). Each row is
one test that ran; "Expected" is the behaviour the test asserts. Regenerate after changing tests
(the commands are at the top of `docs/test-evidence/generate.mjs`).

**Result: 80 of 80 passed.**

| ID        | Input                                                                        | Expected                                                                                   | Actual      | Pass/Fail |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- | --------- |
| NOTIF-001 | loadConfig (config.test.ts)                                                  | reads a complete environment and converts numbers                                          | As expected | Pass      |
| NOTIF-002 | loadConfig (config.test.ts)                                                  | uses auction.events when no exchange is set                                                | As expected | Pass      |
| NOTIF-003 | loadConfig (config.test.ts)                                                  | fails fast, names every missing variable, and never prints a value                         | As expected | Pass      |
| NOTIF-004 | loadConfig (config.test.ts)                                                  | refuses a port that is not a number in range                                               | As expected | Pass      |
| NOTIF-005 | loadConfig (config.test.ts)                                                  | needs only the public key                                                                  | As expected | Pass      |
| NOTIF-006 | storing notifications (consumer.integration.test.ts)                         | stores the welcome message for a new user                                                  | As expected | Pass      |
| NOTIF-007 | storing notifications (consumer.integration.test.ts)                         | stores an outbid notification for the previous highest bidder only                         | As expected | Pass      |
| NOTIF-008 | storing notifications (consumer.integration.test.ts)                         | stores nothing for a first bid                                                             | As expected | Pass      |
| NOTIF-009 | storing notifications (consumer.integration.test.ts)                         | tells the winner, the loser and the seller when an auction is sold                         | As expected | Pass      |
| NOTIF-010 | storing notifications (consumer.integration.test.ts)                         | tells the seller and every bidder when an auction ends without a sale                      | As expected | Pass      |
| NOTIF-011 | storing notifications (consumer.integration.test.ts)                         | tells the seller only when an admin cancelled the auction                                  | As expected | Pass      |
| NOTIF-012 | storing notifications (consumer.integration.test.ts)                         | tells both sides about a completed and a failed payment                                    | As expected | Pass      |
| NOTIF-013 | idempotency (consumer.integration.test.ts)                                   | creates nothing new when the same event is delivered twice                                 | As expected | Pass      |
| NOTIF-014 | idempotency (consumer.integration.test.ts)                                   | creates nothing new for a delivery that arrives in parallel with itself                    | As expected | Pass      |
| NOTIF-015 | idempotency (consumer.integration.test.ts)                                   | adds only what is missing when a retry follows a half-finished first attempt               | As expected | Pass      |
| NOTIF-016 | idempotency (consumer.integration.test.ts)                                   | treats two different events for the same auction as two notifications                      | As expected | Pass      |
| NOTIF-017 | failures (consumer.integration.test.ts)                                      | throws, so the consumer retries and finally dead-letters, when the database fails          | As expected | Pass      |
| NOTIF-018 | GET /notifications (notification-api.integration.test.ts)                    | lists only my notifications, newest first, without internal fields                         | As expected | Pass      |
| NOTIF-019 | GET /notifications (notification-api.integration.test.ts)                    | pages through the list without skipping or repeating a row                                 | As expected | Pass      |
| NOTIF-020 | GET /notifications (notification-api.integration.test.ts)                    | keeps a stable order for notifications created in the same instant                         | As expected | Pass      |
| NOTIF-021 | GET /notifications (notification-api.integration.test.ts)                    | returns an empty list for a user without notifications, admins included                    | As expected | Pass      |
| NOTIF-022 | GET /notifications (notification-api.integration.test.ts)                    | rejects the query page=0 with 400                                                          | As expected | Pass      |
| NOTIF-023 | GET /notifications (notification-api.integration.test.ts)                    | rejects the query page=x with 400                                                          | As expected | Pass      |
| NOTIF-024 | GET /notifications (notification-api.integration.test.ts)                    | rejects the query size=0 with 400                                                          | As expected | Pass      |
| NOTIF-025 | GET /notifications (notification-api.integration.test.ts)                    | rejects the query size=101 with 400                                                        | As expected | Pass      |
| NOTIF-026 | GET /notifications (notification-api.integration.test.ts)                    | rejects the query unknown=1 with 400                                                       | As expected | Pass      |
| NOTIF-027 | GET /notifications (notification-api.integration.test.ts)                    | serves any logged-in role                                                                  | As expected | Pass      |
| NOTIF-028 | GET /notifications/unread-count (notification-api.integration.test.ts)       | counts only my unread notifications                                                        | As expected | Pass      |
| NOTIF-029 | GET /notifications/unread-count (notification-api.integration.test.ts)       | is zero for a user without notifications                                                   | As expected | Pass      |
| NOTIF-030 | GET /notifications/unread-count (notification-api.integration.test.ts)       | is not mistaken for a notification ID                                                      | As expected | Pass      |
| NOTIF-031 | PATCH /notifications/:id/read (notification-api.integration.test.ts)         | marks one notification as read and lowers the unread count                                 | As expected | Pass      |
| NOTIF-032 | PATCH /notifications/:id/read (notification-api.integration.test.ts)         | keeps the first read time when marked twice                                                | As expected | Pass      |
| NOTIF-033 | PATCH /notifications/:id/read (notification-api.integration.test.ts)         | returns 403 for someone else’s notification and changes nothing                            | As expected | Pass      |
| NOTIF-034 | PATCH /notifications/:id/read (notification-api.integration.test.ts)         | returns 404 for a notification that does not exist                                         | As expected | Pass      |
| NOTIF-035 | PATCH /notifications/:id/read (notification-api.integration.test.ts)         | returns 400 for an ID that is not a UUID                                                   | As expected | Pass      |
| NOTIF-036 | POST /notifications/read-all (notification-api.integration.test.ts)          | marks all my unread notifications as read and says how many                                | As expected | Pass      |
| NOTIF-037 | POST /notifications/read-all (notification-api.integration.test.ts)          | never touches another user’s notifications                                                 | As expected | Pass      |
| NOTIF-038 | POST /notifications/read-all (notification-api.integration.test.ts)          | changes nothing the second time                                                            | As expected | Pass      |
| NOTIF-039 | POST /notifications/read-all (notification-api.integration.test.ts)          | keeps the original read time of notifications that were already read                       | As expected | Pass      |
| NOTIF-040 | authentication (notification-api.integration.test.ts)                        | get /notifications returns 401 without a token                                             | As expected | Pass      |
| NOTIF-041 | authentication (notification-api.integration.test.ts)                        | get /notifications/unread-count returns 401 without a token                                | As expected | Pass      |
| NOTIF-042 | authentication (notification-api.integration.test.ts)                        | post /notifications/read-all returns 401 without a token                                   | As expected | Pass      |
| NOTIF-043 | authentication (notification-api.integration.test.ts)                        | patch /notifications/5d72fbd4-f832-408c-bc2e-55c77fdc119b/read returns 401 without a token | As expected | Pass      |
| NOTIF-044 | authentication (notification-api.integration.test.ts)                        | returns 401 for a forged token                                                             | As expected | Pass      |
| NOTIF-045 | authentication (notification-api.integration.test.ts)                        | answers an unknown path with 404, not 401                                                  | As expected | Pass      |
| NOTIF-046 | events become visible through the API (notification-api.integration.test.ts) | shows a notification created by an event handler in the list and the unread count          | As expected | Pass      |
| NOTIF-047 | formatMoney (notification-builder.test.ts)                                   | writes integer cents as a currency amount                                                  | As expected | Pass      |
| NOTIF-048 | user.registered (notification-builder.test.ts)                               | welcomes the new user, naming them, about no auction                                       | As expected | Pass      |
| NOTIF-049 | user.registered (notification-builder.test.ts)                               | removes NUL characters, which Postgres text cannot hold                                    | As expected | Pass      |
| NOTIF-050 | bid.placed (notification-builder.test.ts)                                    | tells the previous highest bidder they were outbid, with the new amount                    | As expected | Pass      |
| NOTIF-051 | bid.placed (notification-builder.test.ts)                                    | tells nobody on the first bid                                                              | As expected | Pass      |
| NOTIF-052 | bid.placed (notification-builder.test.ts)                                    | does not tell a bidder they outbid themselves                                              | As expected | Pass      |
| NOTIF-053 | auction.closed, sold (notification-builder.test.ts)                          | tells the winner, every loser and the seller, each once                                    | As expected | Pass      |
| NOTIF-054 | auction.closed, sold (notification-builder.test.ts)                          | works when nobody lost                                                                     | As expected | Pass      |
| NOTIF-055 | auction.closed, no sale (notification-builder.test.ts)                       | tells the seller when nobody bid                                                           | As expected | Pass      |
| NOTIF-056 | auction.closed, no sale (notification-builder.test.ts)                       | tells every bidder they lost and the seller the reserve was not met                        | As expected | Pass      |
| NOTIF-057 | auction.cancelled (notification-builder.test.ts)                             | tells the seller when an admin cancelled it                                                | As expected | Pass      |
| NOTIF-058 | auction.cancelled (notification-builder.test.ts)                             | tells nobody when the seller cancelled it themselves                                       | As expected | Pass      |
| NOTIF-059 | payment.completed (notification-builder.test.ts)                             | tells the winner what they paid and the seller what they received                          | As expected | Pass      |
| NOTIF-060 | payment.failed (notification-builder.test.ts)                                | tells both sides, and explains an empty balance to the winner                              | As expected | Pass      |
| NOTIF-061 | payment.failed (notification-builder.test.ts)                                | explains a missing wallet to the winner                                                    | As expected | Pass      |
| NOTIF-062 | every notification fits the database limits (notification-builder.test.ts)   | keeps titles and messages within 120 and 1000 characters, even with a long auction title   | As expected | Pass      |
| NOTIF-063 | seed data (schema.integration.test.ts)                                       | loads the demo notifications, with the bell showing two unread for bidder1 and the seller  | As expected | Pass      |
| NOTIF-064 | seed data (schema.integration.test.ts)                                       | is safe to run again                                                                       | As expected | Pass      |
| NOTIF-065 | constraints (schema.integration.test.ts)                                     | accepts a normal notification                                                              | As expected | Pass      |
| NOTIF-066 | constraints (schema.integration.test.ts)                                     | refuses an unknown type                                                                    | As expected | Pass      |
| NOTIF-067 | constraints (schema.integration.test.ts)                                     | refuses a blank title or message                                                           | As expected | Pass      |
| NOTIF-068 | constraints (schema.integration.test.ts)                                     | refuses a title over 120 and a message over 1000 characters                                | As expected | Pass      |
| NOTIF-069 | constraints (schema.integration.test.ts)                                     | refuses a welcome message about an auction, and any other type without one                 | As expected | Pass      |
| NOTIF-070 | constraints (schema.integration.test.ts)                                     | refuses a second notification for the same event and user                                  | As expected | Pass      |
| NOTIF-071 | constraints (schema.integration.test.ts)                                     | allows one event to notify different users                                                 | As expected | Pass      |
| NOTIF-072 | constraints (schema.integration.test.ts)                                     | refuses a read time before the creation time                                               | As expected | Pass      |
| NOTIF-073 | indexes (schema.integration.test.ts)                                         | serves the list and the unread count from their own indexes                                | As expected | Pass      |
| NOTIF-074 | GET /health (service-basics.integration.test.ts)                             | answers 200 while the database is reachable                                                | As expected | Pass      |
| NOTIF-075 | GET /health (service-basics.integration.test.ts)                             | answers 503 in the standard error format when the database is not reachable                | As expected | Pass      |
| NOTIF-076 | headers and limits (service-basics.integration.test.ts)                      | sets security headers and hides the framework                                              | As expected | Pass      |
| NOTIF-077 | headers and limits (service-basics.integration.test.ts)                      | puts a request ID in every answer, errors included                                         | As expected | Pass      |
| NOTIF-078 | headers and limits (service-basics.integration.test.ts)                      | refuses a body over 1 kB with 413 before it reaches any route                              | As expected | Pass      |
| NOTIF-079 | headers and limits (service-basics.integration.test.ts)                      | refuses a body that is not valid JSON with 400                                             | As expected | Pass      |
| NOTIF-080 | headers and limits (service-basics.integration.test.ts)                      | never shows a stack trace for an unexpected error                                          | As expected | Pass      |
