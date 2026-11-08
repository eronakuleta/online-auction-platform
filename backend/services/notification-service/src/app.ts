import {
  ServiceUnavailableError,
  correlationMiddleware,
  createErrorHandler,
  notFoundHandler,
  requestLogger,
  type Logger,
} from '@auction/shared-common';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { pingDatabase } from './repositories/database';

export interface AppDependencies {
  pool: Pool;
  logger: Logger;
}

/** Builds the Express app without listening, so tests can call it directly. */
export function createApp(deps: AppDependencies): Express {
  const { pool, logger } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware());
  // Same headers as the other services. No HSTS: TLS ends at the gateway (gateway/README.md).
  app.use(helmet({ strictTransportSecurity: false }));
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '1kb' }));

  // Used by the Docker health check, so it is not under /api/v1 and is not routed by the gateway.
  app.get('/health', async (_req, res) => {
    try {
      await pingDatabase(pool);
    } catch (err) {
      logger.error({ err }, 'health check failed');
      throw new ServiceUnavailableError('Database is unavailable');
    }
    res.status(200).json({ status: 'ok' });
  });

  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return app;
}
