// Entry point: reads the config and public key, connects, starts listening, and shuts down cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { loadConfig } from './config';
import { createEventHandlers } from './events/consumers';
import { createPool } from './repositories/database';
import { createWalletService } from './services/wallet.service';

const logger = createLogger({ service: 'payment-service' });

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  const verifyToken = createTokenVerifier({
    publicKey: loadPublicKey(config.jwt.publicKeyPath),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  const walletService = createWalletService({ pool, currency: config.currency, logger });

  // Retries while RabbitMQ starts, and declares the exchange and every queue (docs/events.md §6).
  const bus = await connectEventBus({
    url: config.events.rabbitmqUrl,
    exchange: config.events.exchange,
    logger,
  });
  await bus.subscribe('payment-service', createEventHandlers(walletService));

  const app = createApp({ pool, walletService, verifyToken, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'payment-service listening');
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
  logger.fatal({ err }, 'payment-service failed to start');
  process.exit(1);
});
