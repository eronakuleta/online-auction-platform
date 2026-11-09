// Entry point: reads the config, connects, starts consuming events and listening, and shuts down
// cleanly.
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { loadConfig } from './config';
import { createNotificationHandlers } from './events/notification.consumer';
import { createPool } from './repositories/database';
import { createNotificationService } from './services/notification.service';

const logger = createLogger({ service: 'notification-service' });

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  const verifyToken = createTokenVerifier({
    publicKey: loadPublicKey(config.jwt.publicKeyPath),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });

  // notification-service only consumes events; it publishes none.
  const bus = await connectEventBus({
    url: config.events.rabbitmqUrl,
    exchange: config.events.exchange,
    logger,
  });
  await bus.subscribe('notification-service', createNotificationHandlers({ pool, logger }));

  const app = createApp({
    pool,
    notificationService: createNotificationService(pool),
    verifyToken,
    logger,
  });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'notification-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void bus
        .close()
        .then(() => pool.end())
        .then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'notification-service failed to start');
  process.exit(1);
});
