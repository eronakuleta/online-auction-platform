# Defense notes: Anesa

How to explain each of Anesa's tasks (`B-xx`) at the defense. Short, in our own words.

## B-01 Event contract and API conventions

- **Why a contract comes first.** Services never read each other's databases, so events are their only shared language. `docs/events.md` fixes the routing keys, the envelope and every payload, so both of us can build against it at the same time.
- **Why events carry `title` and `losingBidderIds`.** notification-service has to write "you lost the auction for X" without calling another service or reading another database. The publisher already knows these values, so it sends them.
- **Delivery is at-least-once, not exactly-once.** A message can arrive twice, so consumers deduplicate by `eventId` or a unique key such as `settlements.auction_id`. Retries can also change the order, so a consumer ignores any event that is not a valid state transition.
- **Why cancel goes through bidding-service (proposal 2).** "Only before the first bid" spans two databases. Bidding decides under the same `FOR UPDATE` row lock as place-bid, so a bid and a cancel at the same moment cannot both succeed.
- **Known limitation.** Without an outbox, an event is lost if a service crashes between `COMMIT` and publish. We say so openly.
