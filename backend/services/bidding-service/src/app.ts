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
import helmet from 'helmet';
import type { Pool } from 'pg';
import { pingDatabase } from './repositories/database';
import { createInternalRoutes, createRoutes } from './routes';
import type { BiddingService } from './services/bidding.service';

export interface AppDependencies {
  pool: Pool;
  biddingService: BiddingService;
  verifyToken: TokenVerifier;
  logger: Logger;
}

/** Builds the Express app without listening, so tests can call it directly. */
export function createApp(deps: AppDependencies): Express {
  const { pool, biddingService, verifyToken, logger } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.use(correlationMiddleware());
  // Same headers as the other services. No HSTS: TLS ends at the gateway (gateway/README.md).
  app.use(helmet({ strictTransportSecurity: false }));
  app.use(requestLogger(logger));
  // Bodies are tiny ({ "amountCents": 12500 }), so anything bigger is refused early.
  app.use(express.json({ limit: '4kb' }));

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

  app.use('/api/v1', createRoutes(biddingService, verifyToken));
  app.use('/internal', createInternalRoutes(biddingService));

  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return app;
}
