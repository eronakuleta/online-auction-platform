# Defense notes: Anesa

How to explain each of Anesa's tasks (`B-xx`) at the defense. Short, in our own words.

## B-01 Event contract and API conventions

- **Why a contract comes first.** Services never read each other's databases, so events are their only shared language. `docs/events.md` fixes the routing keys, the envelope and every payload, so both of us can build against it at the same time.
- **Why events carry `title` and `losingBidderIds`.** notification-service has to write "you lost the auction for X" without calling another service or reading another database. The publisher already knows these values, so it sends them.
- **Delivery is at-least-once, not exactly-once.** A message can arrive twice, so consumers deduplicate by `eventId` or a unique key such as `settlements.auction_id`. Retries can also change the order, so a consumer ignores any event that is not a valid state transition.
- **Why cancel goes through bidding-service (proposal 2).** "Only before the first bid" spans two databases. Bidding decides under the same `FOR UPDATE` row lock as place-bid, so a bid and a cancel at the same moment cannot both succeed.
- **Known limitation.** Without an outbox, an event is lost if a service crashes between `COMMIT` and publish. We say so openly.

## B-02 Shared logger, errors and event helpers

- **Correlation IDs without passing parameters.** `AsyncLocalStorage` keeps the ID for the current request or event, even across `await`. The logger adds it to every line, and it travels in the `x-correlation-id` message header, so one search follows a request across services. An incoming ID is checked against a safe pattern, which blocks log injection.
- **One error format, in one place.** Services throw `ConflictError('BID_TOO_LOW', ...)`, and the error handler builds the standard body. Unexpected errors become a generic `500`: the real message goes to the logs, never to the client.
- **The contract is enforced in code.** The publisher checks each payload with zod before sending, and the consumer checks it again on receipt. Money must be an integer above 0, so `10.5` fails at the publisher instead of corrupting another service.
- **No message is lost on failure.** A message is acknowledged only after its handler succeeds. To retry, the consumer copies it to the retry queue, waits for the broker's confirm, and only then acknowledges. A crash in between gives a duplicate at worst, which idempotent consumers handle.
- **Why a lost connection exits the process.** Reconnecting and re-subscribing correctly is a lot of code to get right. Exiting is simple and safe: Docker restarts the service, and unacknowledged messages are redelivered.

## B-03 RabbitMQ topology

- **Three queues per service.** The main queue receives events, the retry queue holds a failed message for 5 s, and the DLQ keeps messages that need a person to look at them. Retrying immediately would just fail again while the database is still down.
- **How the delay works without a plugin.** The retry queue has a message TTL and no consumers. When the TTL expires, RabbitMQ dead-letters the message back to the main queue.
- **Why retries skip the topic exchange.** They go through the default exchange, which routes by queue name. Republishing to the topic would hand the message again to every service, including those that already processed it.
- **Why all queues are declared together.** A topic exchange drops a message that no queue is bound to. Declaring every service's queues at setup means `bid.placed` is kept for notification-service even if that service has not started yet.
- **Safe to run repeatedly.** Declaring an existing queue with the same settings does nothing. That is why both `npm run rabbitmq:setup` and each service at startup can do it. Changing a queue's arguments later requires deleting the queue first, or RabbitMQ refuses the declaration.
