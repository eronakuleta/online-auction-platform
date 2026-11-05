// Entry point: reads the config and public key, connects, starts listening, and shuts down cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { createBiddingClient } from './clients/bidding.client';
import { loadConfig } from './config';
import { createPool } from './repositories/database';
import { createAuctionService } from './services/auction.service';

const logger = createLogger({ service: 'auction-service' });

function main(): void {
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
  const auctionService = createAuctionService({
    pool,
    bidding,
    currency: config.currency,
    logger,
  });

  const app = createApp({ pool, auctionService, verifyToken, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'auction-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (err) {
  logger.fatal({ err }, 'auction-service failed to start');
  process.exit(1);
}
