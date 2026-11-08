# Event contract and API conventions

Owner: Anesa (task B-01). Changes need the other member's agreement (`TASKS.md`, working agreement
point 3) and are made here and in `backend/shared/common/src/events/` in the same PR. The zod
schemas in `contract.ts` enforce this document at runtime, so the two must never disagree.

**Status: draft until Erona approves the PR.** Anesa accepted design proposals 1, 2 and 4 on
02.11.2026; together with proposal 3 they are recorded below.

## 1. Exchange and transport

- **Exchange:** `auction.events`, type `topic`, durable. The name comes from `EVENTS_EXCHANGE`.
- **Messages** are persistent JSON. The publisher waits for the broker's confirm.
- **Publish after commit:** a service publishes only after its database transaction commits.
- **Correlation ID** travels in the `x-correlation-id` message header, not in the envelope, so a
  log search follows one request across services.

## 2. Envelope

Every message body has exactly this shape:

```json
{
  "eventId": "3f0c2a54-8d1e-4c7b-9a60-2b7e1f4d9c10",
  "type": "bid.placed",
  "version": 1,
  "occurredAt": "2026-11-02T10:15:30.000Z",
  "payload": {}
}
```

| Field        | Type          | Meaning                                                |
| ------------ | ------------- | ------------------------------------------------------ |
| `eventId`    | UUID          | Unique per event. The key consumers use to deduplicate |
| `type`       | string        | Same as the routing key                                |
| `version`    | integer       | Payload schema version, starts at 1                    |
| `occurredAt` | ISO-8601, UTC | When it happened in the publishing service             |
| `payload`    | object        | Depends on `type` (section 4)                          |

## 3. Event catalog

| Routing key         | Publisher | Consumers                      | Purpose                                 |
| ------------------- | --------- | ------------------------------ | --------------------------------------- |
| `user.registered`   | auth      | payment, notification          | Create the wallet; welcome notification |
| `auction.published` | auction   | bidding                        | Build the local auction snapshot        |
| `auction.cancelled` | auction   | bidding, notification          | Stop accepting bids; notify             |
| `bid.placed`        | bidding   | notification                   | "You were outbid"                       |
| `auction.extended`  | bidding   | auction                        | Update the displayed `endsAt`           |
| `auction.closed`    | bidding   | auction, payment, notification | Result: sold or no sale                 |
| `payment.completed` | payment   | auction, notification          | Mark `SETTLED`, notify both parties     |
| `payment.failed`    | payment   | auction, notification          | Mark `PAYMENT_FAILED`, notify           |

`auction.published` replaces the earlier `auction.created` (proposal 4): bidding needs an auction
only once it is published, and edits are allowed only in `DRAFT`, so the snapshot never needs an
update event. `user.registered` also goes to payment (proposal 3); `UNIQUE (user_id)` on `wallets`
keeps that consumer idempotent.

## 4. Payloads (all version 1)

Common types: IDs are UUIDs, times are ISO-8601 UTC strings, money is an integer number of cents
above 0, and `currency` is a 3-letter ISO 4217 code. `title` is carried in the events so that
notification-service can write a readable message without calling another service.

### `user.registered`

| Field         | Type   | Notes                                                                |
| ------------- | ------ | -------------------------------------------------------------------- |
| `userId`      | UUID   |                                                                      |
| `displayName` | string | For the welcome message. Email is not sent, so it stays in `auth_db` |

### `auction.published`

| Field                | Type          | Notes                       |
| -------------------- | ------------- | --------------------------- |
| `auctionId`          | UUID          |                             |
| `sellerId`           | UUID          |                             |
| `title`              | string        |                             |
| `startsAt`           | timestamp     |                             |
| `endsAt`             | timestamp     |                             |
| `startingPriceCents` | cents         |                             |
| `minIncrementCents`  | cents         |                             |
| `reservePriceCents`  | cents or null | null means no reserve price |
| `currency`           | currency      |                             |

### `auction.cancelled`

| Field         | Type   | Notes                               |
| ------------- | ------ | ----------------------------------- |
| `auctionId`   | UUID   |                                     |
| `sellerId`    | UUID   |                                     |
| `title`       | string |                                     |
| `cancelledBy` | UUID   | The seller, or the admin who did it |

### `bid.placed`

| Field                     | Type         | Notes                                             |
| ------------------------- | ------------ | ------------------------------------------------- |
| `bidId`                   | UUID         |                                                   |
| `auctionId`               | UUID         |                                                   |
| `title`                   | string       |                                                   |
| `bidderId`                | UUID         |                                                   |
| `amountCents`             | cents        |                                                   |
| `currency`                | currency     |                                                   |
| `previousHighestBidderId` | UUID or null | Who gets "you were outbid"; null on the first bid |
| `placedAt`                | timestamp    |                                                   |

### `auction.extended`

| Field            | Type      | Notes                                       |
| ---------------- | --------- | ------------------------------------------- |
| `auctionId`      | UUID      |                                             |
| `endsAt`         | timestamp | The new end time                            |
| `extensionCount` | integer   | Extensions so far, at most `MAX_EXTENSIONS` |

### `auction.closed`

Depends on `result`:

| Field             | When `result` is `SOLD` | When `result` is `NO_SALE`            |
| ----------------- | ----------------------- | ------------------------------------- |
| `auctionId`       | UUID                    | UUID                                  |
| `sellerId`        | UUID                    | UUID                                  |
| `title`           | string                  | string                                |
| `currency`        | currency                | currency                              |
| `closedAt`        | timestamp               | timestamp                             |
| `losingBidderIds` | UUID list               | UUID list (all bidders, may be empty) |
| `winnerId`        | UUID                    | not present                           |
| `amountCents`     | cents                   | not present                           |
| `noSaleReason`    | not present             | `NO_BIDS` or `RESERVE_NOT_MET`        |

### `payment.completed`

| Field          | Type      | Notes                                                       |
| -------------- | --------- | ----------------------------------------------------------- |
| `settlementId` | UUID      |                                                             |
| `auctionId`    | UUID      |                                                             |
| `title`        | string    |                                                             |
| `winnerId`     | UUID      |                                                             |
| `sellerId`     | UUID      |                                                             |
| `amountCents`  | cents     | What the winner paid                                        |
| `feeCents`     | integer   | `floor(amountCents * PLATFORM_FEE_PERCENT / 100)`; can be 0 |
| `sellerCents`  | integer   | `amountCents - feeCents`, so the amounts always add up      |
| `currency`     | currency  |                                                             |
| `settledAt`    | timestamp |                                                             |

### `payment.failed`

| Field         | Type      | Notes                                      |
| ------------- | --------- | ------------------------------------------ |
| `auctionId`   | UUID      |                                            |
| `title`       | string    |                                            |
| `winnerId`    | UUID      |                                            |
| `sellerId`    | UUID      |                                            |
| `amountCents` | cents     |                                            |
| `currency`    | currency  |                                            |
| `reason`      | enum      | `INSUFFICIENT_FUNDS` or `WALLET_NOT_FOUND` |
| `failedAt`    | timestamp |                                            |

## 5. Versioning

- **Adding an optional field** needs no new version. Consumers ignore fields they do not know.
- **Removing or renaming a field, or changing its type or meaning,** is a breaking change: raise
  `version`, and update the publisher and every consumer in the same PR.
- A consumer sends an event with a version it does not support to the dead-letter queue.

## 6. Queues, retries and dead letters

The topology is created by `npm run rabbitmq:setup` (B-03) and again by every service at startup.
Declaring it is idempotent. Each consuming service has three durable queues:

| Queue                    | Purpose                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `<service>.events`       | Main queue, bound to the routing keys in section 3                           |
| `<service>.events.retry` | Holds a failed message for 5 s, then the broker returns it to the main queue |
| `<service>.events.dlq`   | Dead-letter queue: messages that need a person to look at them               |

`<service>` is `auction-service`, `bidding-service`, `payment-service` or `notification-service`.
auth-service only publishes, so it has no queues.

**What happens to a message:**

| Case                                                                      | Result                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------- |
| Handler succeeds                                                          | Acknowledged                                   |
| Handler throws, fewer than 3 retries so far                               | Sent to the retry queue, redelivered after 5 s |
| Handler throws on the 3rd retry (4 attempts in total)                     | Sent to the DLQ                                |
| Bad JSON, invalid envelope or payload, unsupported version, or no handler | Sent to the DLQ at once: a retry cannot fix it |

The retry count is in the `x-retry-count` header, and the DLQ reason in `x-dead-letter-reason`.

## 7. What consumers must do

- **Be idempotent.** Delivery is at-least-once, so the same event can arrive twice. Record
  `eventId` in a `processed_events` table in the same transaction as the effect, or rely on a
  natural unique key (`wallets.user_id`, `settlements.auction_id`).
- **Tolerate order changes.** A retry can overtake newer events. Ignore an event that is not a valid
  state transition, for example `auction.extended` after `auction.closed`, and only ever move
  `endsAt` forward.
- **`auction.cancelled` before `auction.published`:** bidding-service keeps a `CANCELLED` row for an
  auction it has not seen yet, and inserts snapshots with `ON CONFLICT DO NOTHING`, so a late
  `auction.published` cannot reopen it.
- **Lost events are a known limitation.** Without an outbox (stretch goal), an event is lost if a
  service crashes between `COMMIT` and publish. We state this at the defense.

## 8. Internal cancel call (proposal 2)

The rule "a seller can cancel only before the first bid" spans two databases, so bidding-service
decides it under the same row lock as place-bid. Cancelling a `DRAFT` needs no call, because bidding
has never seen it. For a published auction, auction-service calls, with a 2 s timeout:

`POST /internal/auctions/:id/cancel` with body `{ "cancelledBy": "<uuid>", "isAdmin": false }`

| Response                           | Meaning                                                      | auction-service then                                        |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `204`                              | Snapshot marked `CANCELLED`                                  | Sets `CANCELLED`, publishes `auction.cancelled`             |
| `404 AUCTION_NOT_FOUND`            | `auction.published` has not arrived yet, so no bid can exist | Same as `204`; bidding handles the later events (section 7) |
| `409 AUCTION_HAS_BIDS`             | A bid exists and `isAdmin` is false                          | Returns the `409` to the caller                             |
| `409 AUCTION_CLOSED`               | Already closed                                               | Returns the `409` to the caller                             |
| Timeout, connection error or `5xx` | Bidding is unavailable                                       | Returns `503`; nothing changes                              |

`/internal` is never routed by the gateway.

## 9. API conventions

Base path `/api/v1`. The full list of rules is in `CLAUDE.md`. These are the shapes every service
must share, provided by `@auction/shared-common`.

**Error body.** Always this shape, produced by the shared error handler:

```json
{
  "error": {
    "code": "BID_TOO_LOW",
    "message": "Bid must be at least 12500",
    "details": [],
    "requestId": "9b2f6a1e-0c8d-4e57-a3b1-7d4c2e8f6a90"
  }
}
```

- `code` is `UPPER_SNAKE_CASE` and stable, so clients can switch on it. `message` is for people.
- `details` lists field problems as `{ "path": "amountCents", "message": "..." }`, otherwise `[]`.
- `requestId` equals the `X-Request-Id` response header and the `correlationId` in the logs.

| Status | Default `code`        | Error class               | When                                 |
| ------ | --------------------- | ------------------------- | ------------------------------------ |
| `400`  | `VALIDATION_ERROR`    | `ValidationError`         | Invalid body, query, params, headers |
| `401`  | `UNAUTHORIZED`        | `UnauthorizedError`       | Missing or invalid token             |
| `403`  | `FORBIDDEN`           | `ForbiddenError`          | Wrong role, or not the owner         |
| `404`  | `NOT_FOUND`           | `NotFoundError`           | Unknown resource or route            |
| `409`  | required, no default  | `ConflictError`           | State conflict, e.g. `BID_TOO_LOW`   |
| `413`  | `PAYLOAD_TOO_LARGE`   | set by the handler        | Body over the size limit             |
| `429`  | `RATE_LIMITED`        | `TooManyRequestsError`    | Rate limited                         |
| `500`  | `INTERNAL_ERROR`      | set by the handler        | Unexpected; details are only logged  |
| `503`  | `SERVICE_UNAVAILABLE` | `ServiceUnavailableError` | Dependency unavailable               |

**Pagination.** `?page=1&size=20` returns the shape below. `page` starts at 1 and `size` is capped
at 100; a value outside those limits is a `400`.

```json
{ "data": [], "page": 1, "size": 20, "total": 134 }
```

## 10. Other agreed rules

- **Fee rounding:** see `feeCents` in section 4. The platform has one currency (`CURRENCY=EUR`).
- **Clock:** time checks and the closing worker use Postgres `now()`, never the Node clock, because
  there are two bidding replicas.
- **Idempotency key:** unique per `(user_id, key)`, stored with a hash of the request. Reusing a key
  with a different body is a `409`.
- **SSE (proposal 1):** `GET /api/v1/auctions/:id/stream` needs no token, because the native
  `EventSource` cannot send an `Authorization` header and a token in the URL would leak into logs.
  It pushes only public data (highest bid, bid count, `endsAt`, closed status). Placing a bid still
  needs a JWT, and Nginx limits SSE connections per IP.
- **SSE format (B-12):** the stream sends `retry: 3000`, then one `state` event per change, and a
  comment line `: heartbeat` every 15 s. Each event has `id: <version>`, and its `data` is the same
  JSON as `GET /api/v1/auctions/:id/state`, so a page can drop an update older than one it already
  has. Bidding replicas share updates through Redis pub/sub (channel `auction:<id>:live`). The
  response sets `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`; the gateway
  must not buffer it and its read timeout must stay above the 15 s heartbeat (A-21).
- **`TASKS.md` B-11** no longer says the closing worker publishes `bid.placed`; that event comes
  from place-bid (B-06).
