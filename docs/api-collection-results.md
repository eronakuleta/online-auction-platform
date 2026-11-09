# API collection results

Recorded 2026-11-09T13:11:02.731Z. The Node evidence runner executes the same cases that generate the Bruno collection against the real HTTPS gateway. This is not a claim that the Bruno GUI was run. Gateway 429 responses are retried before evaluating business behavior.

| ID         | Input                                                                          | Expected HTTP | Actual                     | Pass/Fail |
| ---------- | ------------------------------------------------------------------------------ | ------------- | -------------------------- | --------- |
| AUTH-01    | POST /auth/login {"email":"bidder1@auction.test","password":"Bidder#Demo2026"} | 200           | 200                        | Pass      |
| AUTH-02    | POST /auth/login {"email":"bidder1@auction.test","password":"wrong"}           | 401           | 401 INVALID_CREDENTIALS    | Pass      |
| AUTH-03    | POST /auth/register {"email":"invalid","password":"x","displayName":""}        | 400           | 400 VALIDATION_ERROR       | Pass      |
| AUTH-04    | GET /users/me                                                                  | 200           | 200                        | Pass      |
| AUTH-05    | GET /users/me                                                                  | 401           | 401 UNAUTHORIZED           | Pass      |
| AUTH-06    | GET /users                                                                     | 403           | 403 FORBIDDEN              | Pass      |
| AUCTION-01 | GET /auctions                                                                  | 200           | 200                        | Pass      |
| AUCTION-02 | GET /auctions?size=100                                                         | 200           | 200                        | Pass      |
| AUCTION-03 | GET /auctions?size=101                                                         | 400           | 400 VALIDATION_ERROR       | Pass      |
| AUCTION-04 | GET /categories                                                                | 200           | 200                        | Pass      |
| AUCTION-05 | GET /auctions/ffffffff-ffff-4fff-8fff-ffffffffffff                             | 404           | 404 NOT_FOUND              | Pass      |
| AUCTION-06 | POST /auctions {}                                                              | 403           | 403 FORBIDDEN              | Pass      |
| BID-01     | GET /auctions/10000000-0000-4000-8000-000000000001/state                       | 200           | 200                        | Pass      |
| BID-02     | GET /auctions/10000000-0000-4000-8000-000000000001/bids?size=100               | 200           | 200                        | Pass      |
| BID-03     | POST /auctions/10000000-0000-4000-8000-000000000001/bids {"amountCents":-1}    | 400           | 400 VALIDATION_ERROR       | Pass      |
| BID-04     | POST /auctions/10000000-0000-4000-8000-000000000001/bids {"amountCents":1000}  | 401           | 401 UNAUTHORIZED           | Pass      |
| BID-05     | GET /bids/me                                                                   | 200           | 200                        | Pass      |
| BID-06     | GET /auctions/ffffffff-ffff-4fff-8fff-ffffffffffff/state                       | 404           | 404 AUCTION_NOT_FOUND      | Pass      |
| PAY-01     | GET /wallet/me                                                                 | 200           | 200                        | Pass      |
| PAY-02     | GET /wallet/me                                                                 | 401           | 401 UNAUTHORIZED           | Pass      |
| PAY-03     | POST /wallet/deposit {"amountCents":0}                                         | 400           | 400 VALIDATION_ERROR       | Pass      |
| PAY-04     | GET /wallet/transactions                                                       | 200           | 200                        | Pass      |
| PAY-05     | GET /payments                                                                  | 403           | 403 FORBIDDEN              | Pass      |
| NOTIFY-01  | GET /notifications                                                             | 200           | 200                        | Pass      |
| NOTIFY-02  | GET /notifications                                                             | 401           | 401 UNAUTHORIZED           | Pass      |
| NOTIFY-03  | GET /notifications/unread-count                                                | 200           | 200                        | Pass      |
| NOTIFY-04  | GET /notifications?size=101                                                    | 400           | 400 VALIDATION_ERROR       | Pass      |
| NOTIFY-05  | PATCH /notifications/ffffffff-ffff-4fff-8fff-ffffffffffff/read                 | 404           | 404 NOTIFICATION_NOT_FOUND | Pass      |
| NOTIFY-06  | POST /notifications/read-all                                                   | 200           | 200                        | Pass      |
