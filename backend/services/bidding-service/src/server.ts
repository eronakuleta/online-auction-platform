// Entry point: reads the config and public key, connects, starts listening, and shuts down cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createClient } from 'redis';
import { createApp } from './app';
import { createPaymentClient } from './clients/payment.client';
import { createAuctionEventHandlers } from './events/auction-events.consumer';
import { startClosingWorker } from './jobs/closing-worker';
import { loadConfig } from './config';
import { createPool } from './repositories/database';
import { createRedisStateCache } from './repositories/state-cache';
import { createBidQueryService } from './services/bid-query.service';
import { createBiddingService } from './services/bidding.service';
import { createClosingService } from './services/closing.service';
import { createIdempotencyService } from './services/idempotency.service';

const logger = createLogger({ service: 'bidding-service' });

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  // The cache is optional: commands fail at once while Redis is unreachable (no offline queue),
  // the service falls back to the database, and the client keeps reconnecting in the background.
  const redis = createClient({
    url: config.redis.url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(200 * (retries + 1), 2000),
    },
  });
  redis.on('error', (err) => logger.warn({ err }, 'Redis connection problem'));
  redis.connect().catch((err: unknown) => logger.warn({ err }, 'Redis not reachable yet'));
  const cache = createRedisStateCache({
    client: redis,
    ttlSeconds: config.redis.stateTtlSeconds,
    logger,
  });

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
    cache,
    payment: createPaymentClient({
      baseUrl: config.payment.url,
      timeoutMs: config.payment.timeoutMs,
      logger,
    }),
  });

  await bus.subscribe('bidding-service', createAuctionEventHandlers({ pool, logger, cache }));

  const closingWorker = startClosingWorker({
    closingService: createClosingService({
      pool,
      publish: bus.publish,
      logger,
      batchSize: config.closing.batchSize,
      cache,
    }),
    intervalMs: config.closing.intervalMs,
    batchSize: config.closing.batchSize,
    logger,
  });

  const app = createApp({
    pool,
    biddingService,
    idempotency: createIdempotencyService(pool),
    queries: createBidQueryService(pool, cache),
    verifyToken,
    logger,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'bidding-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void closingWorker
        .stop()
        .then(() => bus.close())
        .then(() => redis.close())
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
