// Entry point: reads the config and keys, connects, starts listening, and shuts down cleanly.
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTokenVerifier, loadPublicKey } from '@auction/shared-auth';
import { createLogger } from '@auction/shared-common';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './repositories/database';
import { createAuthService } from './services/auth.service';
import { createAccessTokenSigner } from './services/tokens';

const logger = createLogger({ service: 'auth-service' });

function main(): void {
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
  const authService = createAuthService({
    pool,
    signer,
    refreshTtlSeconds: jwt.refreshTtlSeconds,
    logger,
  });

  const server = createApp({ pool, authService, verifyToken, logger }).listen(config.port, () => {
    logger.info({ port: config.port }, 'auth-service listening');
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
  logger.fatal({ err }, 'auth-service failed to start');
  process.exit(1);
}
