// Entry point: reads the config and keys, connects, starts listening, and shuts down cleanly.
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { connectEventBus, createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './repositories/database';
import { createAuthService } from './services/auth.service';
import { createAccessTokenSigner } from './services/tokens';
import { createUserAdminService } from './services/user-admin.service';

const logger = createLogger({ service: 'auth-service' });

async function main(): Promise<void> {
  const config = loadConfig();
  const { jwt } = config;

  const pool = createPool(config.database);
  pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));

  const signer = createAccessTokenSigner({
    privateKey: createPrivateKey(readFileSync(jwt.privateKeyPath, 'utf8')),
    issuer: jwt.issuer,
    audience: jwt.audience,
    ttlSeconds: jwt.accessTtlSeconds,
  });
  const verifyToken = createTokenVerifier({
    publicKey: loadPublicKey(jwt.publicKeyPath),
    issuer: jwt.issuer,
    audience: jwt.audience,
  });
  // auth-service only publishes, so it has no queues of its own.
  const bus = await connectEventBus({
    url: config.events.rabbitmqUrl,
    exchange: config.events.exchange,
    logger,
  });
  const authService = createAuthService({
    pool,
    signer,
    refreshTtlSeconds: jwt.refreshTtlSeconds,
    loginThrottle: config.loginThrottle,
    publish: bus.publish,
    logger,
  });
  const userAdminService = createUserAdminService({ pool, logger });

  const app = createApp({ pool, authService, userAdminService, verifyToken, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'auth-service listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void Promise.allSettled([bus.close(), pool.end()]).then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'auth-service failed to start');
  process.exit(1);
});
