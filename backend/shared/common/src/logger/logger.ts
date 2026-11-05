import { pino, stdSerializers, stdTimeFunctions } from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { getCorrelationId } from './correlation';

export type { Logger };

export interface LoggerOptions {
  /** Added to every line, e.g. `bidding-service`. */
  service: string;
  /** Defaults to the LOG_LEVEL env var, then `info`. */
  level?: string;
  /** Where lines are written. Defaults to stdout; tests pass their own stream. */
  destination?: DestinationStream;
}

// Never log passwords or tokens, even if someone passes a whole object to the logger.
const SECRET_FIELDS = ['password', 'passwordHash', 'token', 'accessToken', 'refreshToken'];
const REDACTED_PATHS = [
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((field) => `*.${field}`),
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

/** Creates the structured JSON logger. Each line includes the current correlation ID, if any. */
export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? 'info',
      base: { service: options.service },
      timestamp: stdTimeFunctions.isoTime,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      serializers: { err: stdSerializers.err },
      mixin() {
        const correlationId = getCorrelationId();
        return correlationId ? { correlationId } : {};
      },
    },
    options.destination,
  );
}
