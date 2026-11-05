import type { TokenVerifier } from '@auction/shared-auth';
import {
  ServiceUnavailableError,
  correlationMiddleware,
  createErrorHandler,
  notFoundHandler,
  requestLogger,
  type Logger,
} from '@auction/shared-common';
import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { pingDatabase } from './repositories/database';
import { createRoutes } from './routes';
import type { AuctionService } from './services/auction.service';

export interface AppDependencies {
  pool: Pool;
  auctionService: AuctionService;
  verifyToken: TokenVerifier;
  logger: Logger;
}

/** Builds the Express app without listening, so tests can call it directly. */
export function createApp(deps: AppDependencies): Express {
  const { pool, auctionService, verifyToken, logger } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware());
  app.use(requestLogger(logger));
  // Room for the longest description (5000) plus ten image URLs (2048 each).
  app.use(express.json({ limit: '64kb' }));

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

  app.use('/api/v1', createRoutes(auctionService, verifyToken));

  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return app;
}
