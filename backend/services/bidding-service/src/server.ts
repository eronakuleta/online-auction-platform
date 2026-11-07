// Entry point: reads the config and public key, connects, starts listening, and shuts down cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { createAuctionEventHandlers } from './events/auction-events.consumer';
import { startClosingWorker } from './jobs/closing-worker';
import { loadConfig } from './config';
import { createPool } from './repositories/database';
import { createBiddingService } from './services/bidding.service';
import { createClosingService } from './services/closing.service';

const logger = createLogger({ service: 'bidding-service' });

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  const verifyToken = createTokenVerifier({
    publicKey: loadPublicKey(config.jwt.publicKeyPath),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  // Publishes bid.placed, auction.extended and auction.closed; consumes auction.published and
  // auction.cancelled to keep the local snapshot (B-05).
  const bus = await connectEventBus({
    url: config.events.rabbitmqUrl,
    exchange: config.events.exchange,
    logger,
  });
  const biddingService = createBiddingService({
    pool,
    publish: bus.publish,
    logger,
    antiSniping: config.antiSniping,
  });

  await bus.subscribe('bidding-service', createAuctionEventHandlers({ pool, logger }));

  const closingWorker = startClosingWorker({
    closingService: createClosingService({
      pool,
      publish: bus.publish,
      logger,
      batchSize: config.closing.batchSize,
    }),
    intervalMs: config.closing.intervalMs,
    batchSize: config.closing.batchSize,
    logger,
  });

  const app = createApp({ pool, biddingService, verifyToken, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'bidding-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void closingWorker
        .stop()
        .then(() => bus.close())
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'bidding-service failed to start');
  process.exit(1);
});
