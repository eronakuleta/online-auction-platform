// Reads every setting from environment variables once, and stops the service at startup if one is
// missing or invalid. Only variable names are reported, never values, because some are secrets.
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const required = z.string().min(1);

const envSchema = z.object({
  BIDDING_SERVICE_PORT: port,
  POSTGRES_HOST: required,
  POSTGRES_PORT: port,
  POSTGRES_USER: required,
  POSTGRES_PASSWORD: required,
  BIDDING_DB_NAME: required,
  JWT_PUBLIC_KEY_PATH: required,
  JWT_ISSUER: required,
  JWT_AUDIENCE: required,
  RABBITMQ_URL: required,
  EVENTS_EXCHANGE: required.default('auction.events'),
  SNIPE_WINDOW_SECONDS: z.coerce.number().int().min(0),
  SNIPE_EXTENSION_SECONDS: z.coerce.number().int().positive(),
  MAX_EXTENSIONS: z.coerce.number().int().min(0),
  PAYMENT_SERVICE_URL: z.url(),
  FUNDS_CHECK_TIMEOUT_MS: z.coerce.number().int().positive(),
  REDIS_URL: required,
  STATE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  CLOSING_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  CLOSING_BATCH_SIZE: z.coerce.number().int().positive().default(50),
});

export interface Config {
  port: number;
  database: { host: string; port: number; user: string; password: string; database: string };
  /** Only the public key: bidding-service verifies tokens but can never create them. */
  jwt: { publicKeyPath: string; issuer: string; audience: string };
  events: { rabbitmqUrl: string; exchange: string };
  antiSniping: { windowSeconds: number; extensionSeconds: number; maxExtensions: number };
  closing: { intervalMs: number; batchSize: number };
  payment: { url: string; timeoutMs: number };
  /** REDIS_URL may contain a password, so it is never logged. */
  redis: { url: string; stateTtlSeconds: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid or missing environment variables: ${names}. See .env.example.`);
  }
  const values = parsed.data;
  return {
    port: values.BIDDING_SERVICE_PORT,
    database: {
      host: values.POSTGRES_HOST,
      port: values.POSTGRES_PORT,
      user: values.POSTGRES_USER,
      password: values.POSTGRES_PASSWORD,
      database: values.BIDDING_DB_NAME,
    },
    jwt: {
      publicKeyPath: values.JWT_PUBLIC_KEY_PATH,
      issuer: values.JWT_ISSUER,
      audience: values.JWT_AUDIENCE,
    },
    events: { rabbitmqUrl: values.RABBITMQ_URL, exchange: values.EVENTS_EXCHANGE },
    antiSniping: {
      windowSeconds: values.SNIPE_WINDOW_SECONDS,
      extensionSeconds: values.SNIPE_EXTENSION_SECONDS,
      maxExtensions: values.MAX_EXTENSIONS,
    },
    redis: { url: values.REDIS_URL, stateTtlSeconds: values.STATE_CACHE_TTL_SECONDS },
    payment: { url: values.PAYMENT_SERVICE_URL, timeoutMs: values.FUNDS_CHECK_TIMEOUT_MS },
    closing: { intervalMs: values.CLOSING_INTERVAL_MS, batchSize: values.CLOSING_BATCH_SIZE },
  };
}
