// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL files
// as production (seed included), and tokens signed with a key pair made for the test.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTokenVerifier, type Role } from '@auction/shared-auth';
import {
  createEvent,
  createLogger,
  type DomainEvent,
  type EventHandlers,
  type Publish,
} from '@auction/shared-common';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Client, Pool } from 'pg';
import { createApp } from '../app';
import { createEventHandlers } from '../events/consumers';
import { createSettlementService } from '../services/settlement.service';
import { createWalletService } from '../services/wallet.service';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/payment');
const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';

/** From database/auth/002_seed.sql and database/payment/002_seed.sql. */
export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const SELLER_ID = '00000000-0000-4000-8000-000000000002';
export const BIDDER_ID = '00000000-0000-4000-8000-000000000003';
export const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';
export const SELLER_START_CENTS = 10_000;
export const BIDDER_START_CENTS = 100_000;
/** The fee the tests settle with (.env.example default). */
export const PLATFORM_FEE_PERCENT = 5;
export const PLATFORM_WALLET_ID = '40000000-0000-4000-8000-000000000000';

export interface TestContext {
  app: Express;
  pool: Pool;
  /** The real handlers the RabbitMQ consumer calls, so tests can deliver events directly. */
  handlers: Required<EventHandlers<'payment-service'>>;
  /** Every event the service published, in order, already checked against the contract. */
  published: DomainEvent[];
  /** Makes publish() throw, as it does when the broker is down. */
  failPublishing(fail: boolean): void;
  tokenFor(roles: Role[], userId?: string): string;
  close(): Promise<void>;
}

async function withAdminClient(work: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

export async function createTestContext(): Promise<TestContext> {
  const database = `payment_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${database}`));

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString() });
  for (const file of readdirSync(SQL_DIR).sort()) {
    await pool.query(readFileSync(join(SQL_DIR, file), 'utf8'));
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const logger = createLogger({ service: 'payment-service-test', level: 'silent' });
  const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
  const walletService = createWalletService({ pool, currency: 'EUR', logger });
  const published: DomainEvent[] = [];
  let publishFails = false;
  // createEvent validates the payload against the shared contract, as the real publisher does.
  const publish: Publish = async (type, payload) => {
    if (publishFails) throw new Error('broker unavailable');
    const event = createEvent(type, payload);
    // TypeScript cannot narrow the generic DomainEvent<T> to the union; the value is the same.
    published.push(event as DomainEvent);
    return Promise.resolve(event);
  };
  const settlementService = createSettlementService({
    pool,
    feePercent: PLATFORM_FEE_PERCENT,
    currency: 'EUR',
    publish,
    logger,
  });

  return {
    app: createApp({ pool, walletService, settlementService, verifyToken, logger }),
    pool,
    handlers: createEventHandlers(walletService, settlementService),
    published,
    failPublishing(fail) {
      publishFails = fail;
    },
    tokenFor: (roles, userId = randomUUID()) =>
      jwt.sign({ roles }, privateKey, {
        algorithm: 'RS256',
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 900,
      }),
    async close() {
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
    },
  };
}
