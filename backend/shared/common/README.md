# @auction/shared-common

Logger, standard errors and RabbitMQ event helpers for every backend service (owner: Anesa, B-02
and B-03). The JWT middleware is separate, in `@auction/shared-auth`. Contract:
[`docs/events.md`](../../../docs/events.md).

Packages import each other's built output, so run `npm run build:shared` once after installing or
changing shared code. The root `npm run typecheck`, `npm run build` and `npm test` do it for you.

## Express setup

```ts
import express from 'express';
import {
  ConflictError,
  correlationMiddleware,
  createErrorHandler,
  createLogger,
  notFoundHandler,
  requestLogger,
} from '@auction/shared-common';

const logger = createLogger({ service: 'auction-service' });
const app = express();

app.use(correlationMiddleware()); // first, so everything after it has a correlation ID
app.use(requestLogger(logger));
app.use(express.json());

app.post('/api/v1/auctions/:id/publish', (_req, _res) => {
  // Throw instead of building a response. A thrown ZodError also becomes a 400.
  throw new ConflictError('AUCTION_NOT_DRAFT', 'Only a draft can be published');
});

app.use(notFoundHandler()); // after all routes
app.use(createErrorHandler(logger)); // last
```

Express 5 passes errors from `async` route handlers to the error handler by itself. On Express 4
you would need to call `next(err)`.

`A-05`: `authenticate()` throws `UnauthorizedError` and `requireRole()` throws `ForbiddenError`.

## Events

```ts
import { connectEventBus } from '@auction/shared-common';

const bus = await connectEventBus({
  url: config.rabbitmqUrl,
  exchange: config.eventsExchange,
  logger,
});

// Publish only after the database transaction has committed. The payload is checked against the
// contract, so a wrong field throws here, not in another service.
await bus.publish('auction.cancelled', { auctionId, sellerId, title, cancelledBy });

// Handlers must be idempotent. Throwing means "retry later" (3 retries, then the DLQ). TypeScript
// allows only the events this service subscribes to (`SERVICE_SUBSCRIPTIONS` in topology.ts).
await bus.subscribe('auction-service', {
  'auction.closed': async (event) => {
    if (event.payload.result === 'SOLD') {
      await markSold(event.eventId, event.payload.auctionId, event.payload.winnerId);
    }
  },
});

// On shutdown:
await bus.close();
```
