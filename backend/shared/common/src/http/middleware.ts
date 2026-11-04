import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../errors/app-error';
import {
  getCorrelationId,
  resolveCorrelationId,
  runWithCorrelationId,
} from '../logger/correlation';
import type { Logger } from '../logger/logger';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** First middleware: gives the request a correlation ID and returns it in the response header. */
export function correlationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const correlationId = resolveCorrelationId(req.get(REQUEST_ID_HEADER));
    res.setHeader(REQUEST_ID_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  };
}

/** Logs one line per finished request. Uses the path only, as a query string can hold user data. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    // The 'finish' event fires outside the request's async context, so keep the ID now.
    const correlationId = getCorrelationId();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info(
        {
          correlationId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs),
        },
        'request finished',
      );
    });
    next();
  };
}

/** Mount after all routes: an unknown route becomes the standard 404. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  };
}

/** Mount last. Sends every error in the standard format and logs what clients must not see. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const appError = toAppError(err);
    if (appError.status >= 500) {
      logger.error({ err, method: req.method, path: req.path }, 'request failed');
    } else {
      logger.info(
        { code: appError.code, status: appError.status, method: req.method, path: req.path },
        'request rejected',
      );
    }
    res.status(appError.status).json(appError.toBody(getCorrelationId() ?? randomUUID()));
  };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return new ValidationError('Invalid input', details);
  }
  // express.json() marks its own errors with a `type` field.
  const bodyParserType = (err as { type?: unknown } | null)?.type;
  if (bodyParserType === 'entity.parse.failed') {
    return new ValidationError('Request body is not valid JSON', [], 'INVALID_JSON');
  }
  if (bodyParserType === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  // Anything else is a bug or an outage. The real message is logged, never sent to the client.
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
}
