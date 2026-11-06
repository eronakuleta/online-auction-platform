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
});

export interface Config {
  port: number;
  database: { host: string; port: number; user: string; password: string; database: string };
  /** Only the public key: bidding-service verifies tokens but can never create them. */
  jwt: { publicKeyPath: string; issuer: string; audience: string };
  events: { rabbitmqUrl: string; exchange: string };
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
  };
}
