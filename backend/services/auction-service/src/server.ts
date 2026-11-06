// Entry point: reads the config and public key, connects, starts listening, and shuts down cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { createBiddingClient } from './clients/bidding.client';
import { loadConfig } from './config';
import { createEventHandlers } from './events/consumers';
import { createPool } from './repositories/database';
import { createAuctionEventService } from './services/auction-event.service';
import { createAuctionService } from './services/auction.service';

const logger = createLogger({ service: 'auction-service' });

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  const verifyToken = createTokenVerifier({
    publicKey: loadPublicKey(config.jwt.publicKeyPath),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  const bidding = createBiddingClient({
    baseUrl: config.bidding.url,
    timeoutMs: config.bidding.timeoutMs,
    logger,
  });
  // Retries while RabbitMQ starts, and declares the exchange and every queue (docs/events.md §6).
  const bus = await connectEventBus({
    url: config.events.rabbitmqUrl,
    exchange: config.events.exchange,
    logger,
  });
  const auctionService = createAuctionService({
    pool,
    bidding,
    currency: config.currency,
    publish: bus.publish,
    logger,
  });
  const auctionEvents = createAuctionEventService({ pool, logger });
  await bus.subscribe('auction-service', createEventHandlers(auctionEvents));

  const app = createApp({ pool, auctionService, verifyToken, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'auction-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      // The bus first: it waits for events in progress, which still need the database.
      void bus
        .close()
        .catch((err: unknown) => logger.error({ err }, 'could not close the event bus'))
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'auction-service failed to start');
  process.exit(1);
});
