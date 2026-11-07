// Reads every setting from environment variables once, and stops the service at startup if one is
// missing or invalid. Only variable names are reported, never values, because some are secrets.
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const required = z.string().min(1);

const envSchema = z.object({
  PAYMENT_SERVICE_PORT: port,
  POSTGRES_HOST: required,
  POSTGRES_PORT: port,
  POSTGRES_USER: required,
  POSTGRES_PASSWORD: required,
  PAYMENT_DB_NAME: required,
  JWT_PUBLIC_KEY_PATH: required,
  JWT_ISSUER: required,
  JWT_AUDIENCE: required,
  CURRENCY: z.string().regex(/^[A-Z]{3}$/),
  RABBITMQ_URL: required,
  EVENTS_EXCHANGE: required,
  PLATFORM_FEE_PERCENT: z.coerce.number().int().min(0).max(100),
});

export interface Config {
  port: number;
  database: { host: string; port: number; user: string; password: string; database: string };
  /** Only the public key: payment-service verifies tokens but can never create them. */
  jwt: { publicKeyPath: string; issuer: string; audience: string };
  /** The platform has one currency, so every wallet uses it. */
  currency: string;
  /** The URL contains the RabbitMQ password, so it is never logged. */
  events: { rabbitmqUrl: string; exchange: string };
  /** The platform keeps floor(amount * percent / 100) of every sale. */
  platformFeePercent: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid or missing environment variables: ${names}. See .env.example.`);
  }
  const values = parsed.data;
  return {
    port: values.PAYMENT_SERVICE_PORT,
    database: {
      host: values.POSTGRES_HOST,
      port: values.POSTGRES_PORT,
      user: values.POSTGRES_USER,
      password: values.POSTGRES_PASSWORD,
      database: values.PAYMENT_DB_NAME,
    },
    jwt: {
      publicKeyPath: values.JWT_PUBLIC_KEY_PATH,
      issuer: values.JWT_ISSUER,
      audience: values.JWT_AUDIENCE,
    },
    currency: values.CURRENCY,
    events: { rabbitmqUrl: values.RABBITMQ_URL, exchange: values.EVENTS_EXCHANGE },
    platformFeePercent: values.PLATFORM_FEE_PERCENT,
  };
}
