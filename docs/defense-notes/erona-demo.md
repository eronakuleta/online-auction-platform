# Defense: Erona's demo script and live-change drills (A-30)

Everything here runs on the real stack. Commands are for Git Bash in the repository root. Rehearse
it once from a fresh start; the whole demo takes about 8 minutes.

## 0. Before the defense

```bash
docker compose up -d --build --wait
```

```bash
docker compose ps
```

All services must show `healthy`. Open <https://localhost:8443/health> once in the browser and
accept the certificate warning (local self-signed certificate), then start the UI:

```bash
npm run dev -w frontend
```

Keep a terminal with this helper loaded; it logs in and keeps the token in `$TOKEN`:

```bash
api() { curl -s --cacert gateway/certs/cert.pem -H "Content-Type: application/json" ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$@"; }
```

```bash
login() { TOKEN=$(api https://localhost:8443/api/v1/auth/login -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken'); }
```

Demo accounts (seed): `seller@auction.test` / `Seller#Demo2026`, `bidder1@auction.test` and
`bidder2@auction.test` / `Bidder#Demo2026`, `admin@auction.test` / `Admin#Demo2026`.

## 1. The UI (2 minutes)

1. <http://localhost:5173>: the catalog. Search `camera`, filter a category, sort by price: the
   URL holds the filters (copy it into a new tab, same result).
2. Log in as the seller: "My auctions" shows drafts too (`GET /auctions/mine`). Create a draft,
   edit it, publish it: it appears in the catalog. Point out the confirmation dialogs.
3. Wallet page as bidder1: balance, a deposit of 12.50, the ledger row with the balance after it.

## 2. A real bid, closing and settlement across services (3 minutes)

The seeded live auction `10000000-0000-4000-8000-000000000001` (Vintage 35mm film camera) has a
highest bid of 55.00 by bidder2 and a reserve of 80.00.

```bash
login bidder1@auction.test 'Bidder#Demo2026'
```

```bash
api https://localhost:8443/api/v1/auctions/10000000-0000-4000-8000-000000000001/bids -d '{"amountCents":9000}'
```

bidding-service accepts 90.00 (over the reserve). Now end the auction early instead of waiting
three days; this is the only manual step, and it touches only bidding's own database. Both end
times move, because a CHECK forbids `ends_at` before `original_ends_at` (anti-sniping only ever
extends):

```bash
docker compose exec -T postgres psql -U auction -d bidding_db -c "UPDATE auction_state SET ends_at = now(), original_ends_at = now() WHERE auction_id = '10000000-0000-4000-8000-000000000001'"
```

Within a second the closing worker closes it and publishes `auction.closed`. Show the result:

```bash
api https://localhost:8443/api/v1/auctions/10000000-0000-4000-8000-000000000001 | node -pe 'const a=JSON.parse(require("fs").readFileSync(0)); [a.status, a.winnerId, a.finalPriceCents]'
```

It says `SETTLED`: auction-service heard `auction.closed`, payment-service settled, and
auction-service heard `payment.completed`. Show the money: bidder1's wallet page has a debit of
90.00; the seller's has a credit of 85.50; as admin:

```bash
login admin@auction.test 'Admin#Demo2026'
```

```bash
api "https://localhost:8443/api/v1/payments?size=1"
```

The settlement shows `amountCents 9000, feeCents 450, sellerCents 8550`. The RabbitMQ management
UI at <http://localhost:15672> shows the queues and the empty dead-letter queues.

Fallback if anything misbehaves: `npm run test:settlement` runs the same chain as a test.

This step uses up the seeded auction. To show it again you need fresh seed data, which means
recreating the database volume (`docker compose down -v`, then up again): that deletes **all**
local data, so do it only on the demo machine, before the defense, never with work you want to
keep. Rehearsed on a fresh stack on 07.11.2026: bid 90.00 accepted, auction `SETTLED` within a
second, settlement fee 450 and seller 8550 cents, seller balance 100.00 to 185.50.

## 3. Security in one minute

```bash
NODE_EXTRA_CA_CERTS=gateway/certs/cert.pem npm run test:security
```

45 tests: forged and edited tokens, the RBAC matrix, SQL injection payloads, CORS, headers. Then
show `/internal` is unreachable:

```bash
api -i https://localhost:8443/api/v1/payments/internal/funds-check
```

## 4. Live-change drills (the examiner asks for a change)

Each drill: where to change, how to prove it, how long it takes. Practise each once.

| Request                               | Where                                                                                                                     | Proof                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| "Change the platform fee to 10%"      | `.env`: `PLATFORM_FEE_PERCENT=10`, then `docker compose up -d payment-service`                                            | Repeat the settlement demo: fee 900 of 9000. Config only, no code                                                                 |
| "Allow deposits up to 20,000"         | `MAX_DEPOSIT_CENTS` in `backend/services/payment-service/src/schemas/wallet.schemas.ts` and Q12 in `docs/requirements.md` | The limit test in `wallet.integration.test.ts` fails until updated: update it, run `npm test -w backend/services/payment-service` |
| "Lock accounts after 3 failed logins" | `.env`: `LOGIN_MAX_FAILED_ATTEMPTS=3`, restart auth-service                                                               | Four wrong logins: the fourth gets the same 401, also with the right password                                                     |
| "Category names up to 80 characters"  | `category.schemas.ts` and a new `database/auction/004_*.sql` changing the CHECK (never edit 001)                          | The exact-limit test fails until updated                                                                                          |
| "Add a field to an endpoint"          | schema (zod) → service → repository → `docs/api/*.yaml`                                                                   | The OpenAPI coverage test fails if the spec is forgotten                                                                          |
| "Show that a rule is enforced"        | `backend/services/auction-service/src/services/auction-states.ts`: allow `CANCELLED → PUBLISHED`                          | `auction-states.test.ts` fails at once (49 pairs)                                                                                 |

## 5. Questions to expect

- **Why microservices?** The domain splits (catalog, live bidding with row locks, money), each of
  us owns a slice; the price is no cross-service transaction, solved with events, a timed call
  or a single owner (the cancel rule). For this size a monolith would be simpler, and we say so.
- **What if RabbitMQ is down when an auction closes?** The close is committed and logged; the
  event is lost (no outbox). An outbox table published by a background job would fix it.
- **Two bids at the same moment?** bidding-service locks the auction row (`FOR UPDATE`); the
  second bid waits and is then checked against the new highest bid (Anesa's part).
- **Can money be created or lost?** No: one transaction, a ledger row per change, CHECKs that
  balances stay ≥ 0 and that fee + seller part = amount; a test checks balance = ledger sum.
- **Why is a draft a 404 for others?** A 403 would reveal that it exists (Q4).
- **How do you know the tests are good?** Mutation checks: every rule was broken on purpose and a
  test had to fail; weak tests found that way were fixed.
