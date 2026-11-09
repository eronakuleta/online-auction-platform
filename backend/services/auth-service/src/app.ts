import type { TokenVerifier } from '@auction/shared-auth';
import {
  ServiceUnavailableError,
  correlationMiddleware,
  installMetrics,
  createErrorHandler,
  notFoundHandler,
  requestLogger,
  type Logger,
} from '@auction/shared-common';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { pingDatabase } from './repositories/database';
import { createRoutes } from './routes';
import type { AuthService } from './services/auth.service';
import type { UserAdminService } from './services/user-admin.service';

export interface AppDependencies {
  pool: Pool;
  authService: AuthService;
  userAdminService: UserAdminService;
  verifyToken: TokenVerifier;
  logger: Logger;
}

/** Builds the Express app without listening, so tests can call it directly. */
export function createApp(deps: AppDependencies): Express {
  const { pool, authService, userAdminService, verifyToken, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  installMetrics(app, 'auth-service');

  app.use(correlationMiddleware());
  // Security headers on every answer (nosniff, no framing, no referrer, a strict CSP). No HSTS:
  // TLS ends at the gateway, and on localhost it would force HTTPS on every other local project
  // too (gateway/README.md, TLS limits).
  app.use(helmet({ strictTransportSecurity: false }));
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '10kb' }));

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

  app.use('/api/v1', createRoutes({ authService, userAdminService, verifyToken }));

  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return app;
}
