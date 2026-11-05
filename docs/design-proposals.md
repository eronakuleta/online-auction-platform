# Design proposals from the plan review (30.10.2026)

Gaps found while reviewing `ROADMAP.md`, `TASKS.md` and `CLAUDE.md` before coding.
Erona has accepted all four. Proposals 1, 2 and 4 change Anesa's services or the event
contract, so they become binding only when Anesa agrees. Anesa then records them in `docs/events.md`
(B-01), and the roadmap is updated in the same PR.

| #   | Proposal                                             | Owner affected                   | Status                                   |
| --- | ---------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| 1   | Public SSE stream                                    | Anesa (bidding), Erona (gateway) | Accepted by Erona, **waiting for Anesa** |
| 2   | Cancel goes through bidding-service                  | Erona (auction), Anesa (bidding) | Accepted by Erona, **waiting for Anesa** |
| 3   | payment-service creates wallets on `user.registered` | Erona (payment, auth)            | **Accepted**                             |
| 4   | Rename `auction.created` to `auction.published`      | Erona (auction), Anesa (bidding) | Accepted by Erona, **waiting for Anesa** |

## 1. Public SSE stream

**Problem.** The browser's native `EventSource` cannot send an `Authorization` header. Putting the
JWT in the query string leaks it into Nginx access logs and browser history.

**Proposal.** `GET /api/v1/auctions/:id/stream` needs no authentication. It only pushes data that
is already public (current highest bid, bid count, `endsAt`, closed status). Placing a bid still
needs a valid JWT. Nginx limits SSE connections per IP (`limit_conn`).

## 2. Cancel goes through bidding-service

**Problem.** The rule "seller can cancel only before the first bid" spans two databases. Bids live
in `bidding_db`, but cancel is handled by auction-service. A cancel and a bid arriving at the same
moment could both succeed.

**Proposal.** `POST /auctions/:id/cancel` in auction-service first calls
`POST /internal/auctions/:id/cancel` on bidding-service, with a 2 s timeout. Bidding takes the
same `SELECT ... FOR UPDATE` row lock that place-bid uses, refuses with `409 AUCTION_HAS_BIDS` if
a bid exists (unless the caller is an admin), and otherwise marks its snapshot `CANCELLED`. Only
then does auction-service set `CANCELLED` and publish `auction.cancelled`. If bidding is down, the
cancel fails with `503`. The `/internal` path is never routed by the gateway.

## 3. Wallets are created on `user.registered`

**Problem.** In the event catalog only notification-service consumes `user.registered`, so no
service creates a wallet for a new user.

**Proposal.** payment-service also consumes `user.registered` and inserts a zero-balance wallet.
`UNIQUE (user_id)` on `wallets` keeps the consumer idempotent. The platform fee wallet and wallets
for the seeded demo users come from the payment seed file.

## 4. Rename `auction.created` to `auction.published`

**Problem.** Bidding needs an auction only once it is published (drafts can still change), but the
event is called `auction.created`.

**Proposal.** auction-service publishes `auction.published` from the `publish` action, with
`auctionId, sellerId, startsAt, endsAt, startingPriceCents, minIncrementCents, reservePriceCents,
currency`. Bidding stores the snapshot with local status `OPEN`. Because edits are allowed only in
`DRAFT`, the snapshot never needs an update event.

## Smaller points to agree on in the B-01 contract

- **Fee rounding:** `feeCents = floor(amountCents * PLATFORM_FEE_PERCENT / 100)`, and
  `sellerCents = amountCents - feeCents`, so the amounts always add up exactly.
- **One currency** for the platform (`CURRENCY=EUR`).
- **Clock:** all time checks and the closing worker use Postgres `now()`, never the Node clock,
  because there are two bidding replicas.
- **Out-of-order events:** consumers ignore an event that is not a valid state transition, for
  example `auction.extended` arriving after `auction.closed`.
- **Lost events:** without an outbox (stretch goal), an event can be lost if the service crashes
  between COMMIT and publish. We state this limitation at the defense.
- **Idempotency key** is unique per `(user_id, key)` and stores a hash of the request. Reusing a
  key with a different body is a `409`.
- **Images** are URLs only. There is no file upload.
- **Banned users** keep a valid access token until it expires (at most 15 minutes).
- `TASKS.md` B-11 says the closing worker publishes `bid.placed`. That event comes from place-bid
  (B-06), so this is a typo.
