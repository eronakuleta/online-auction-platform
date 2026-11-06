// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL
// files as production. Mocked repositories would not prove the constraints or the row locks.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTokenVerifier } from '@auction/shared-auth';
import { createEvent, createLogger, type DomainEvent, type Publish } from '@auction/shared-common';
import type { Express } from 'express';
import { Client, Pool } from 'pg';
import { createApp } from '../app';
import { createAuthService } from '../services/auth.service';
import { createAccessTokenSigner } from '../services/tokens';
import { createUserAdminService } from '../services/user-admin.service';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/auth');

export const ISSUER = 'auction-auth-service';
export const AUDIENCE = 'auction-platform';
export const LOGIN_THROTTLE = { maxFailures: 5, lockSeconds: 300 };

export interface TestContext {
  app: Express;
  pool: Pool;
  publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];
  /** Events published so far. Built with createEvent, so they are checked against the contract. */
  published: DomainEvent[];
  /** Makes the next publish fail, as if the broker were down. */
  failNextPublish(): void;
  close(): Promise<void>;
}

async function withAdminClient(work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

export async function createTestContext(): Promise<TestContext> {
  const database = `auth_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${database}`).then(() => {}));

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString() });

  for (const file of readdirSync(SQL_DIR).sort()) {
    await pool.query(readFileSync(join(SQL_DIR, file), 'utf8'));
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const logger = createLogger({ service: 'auth-service-test', level: 'silent' });
  const signer = createAccessTokenSigner({
    privateKey,
    issuer: ISSUER,
    audience: AUDIENCE,
    ttlSeconds: 900,
  });
  const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });

  const published: DomainEvent[] = [];
  let publishFails = false;
  const publish: Publish = async (type, payload) => {
    if (publishFails) {
      publishFails = false;
      throw new Error('broker is down');
    }
    const event = createEvent(type, payload);
    published.push(event as DomainEvent);
    return event;
  };

  const authService = createAuthService({
    pool,
    signer,
    refreshTtlSeconds: 3600,
    loginThrottle: LOGIN_THROTTLE,
    publish,
    logger,
  });
  const userAdminService = createUserAdminService({ pool, logger });

  return {
    app: createApp({ pool, authService, userAdminService, verifyToken, logger }),
    pool,
    publicKey,
    published,
    failNextPublish() {
      publishFails = true;
    },
    async close() {
      await pool.end();
      await withAdminClient((client) =>
        client.query(`DROP DATABASE ${database} WITH (FORCE)`).then(() => {}),
      );
    },
  };
}

let counter = 0;

/** A valid registration body with an email no other test uses. */
export function newUser(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    email: `user${counter}@test.io`,
    password: 'correct horse battery',
    displayName: `User ${counter}`,
    ...overrides,
  };
}
