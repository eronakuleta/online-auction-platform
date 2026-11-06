// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL
// files as production, real RS256 tokens, and a fake publisher that records events.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTokenVerifier, type Role } from '@auction/shared-auth';
import { createEvent, createLogger, type DomainEvent, type Publish } from '@auction/shared-common';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { Client, Pool } from 'pg';
import { createApp } from '../app';
import { createBiddingService } from '../services/bidding.service';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/bidding');
const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';

/** From database/auth/002_seed.sql and database/bidding/002_seed.sql. */
export const SELLER_ID = '00000000-0000-4000-8000-000000000002';
export const BIDDER1_ID = '00000000-0000-4000-8000-000000000003';
export const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';
/** Live, 2 bids, highest 5500 by bidder2, increment 500. */
export const LIVE_WITH_BIDS_ID = '10000000-0000-4000-8000-000000000001';
/** Live, no bids, starting price 2000, increment 200. */
export const LIVE_NO_BIDS_ID = '10000000-0000-4000-8000-000000000002';
/** Starts tomorrow. */
export const UPCOMING_ID = '10000000-0000-4000-8000-000000000003';
/** CLOSED_NO_SALE. */
export const CLOSED_ID = '10000000-0000-4000-8000-000000000006';

export interface TestContext {
  app: Express;
  pool: Pool;
  /** Events published so far. Built with createEvent, so they are checked against the contract. */
  published: DomainEvent[];
  /** Makes the next publish fail, as if the broker were down. */
  failNextPublish(): void;
  tokenFor(userId: string, roles?: Role[]): string;
  /** Adds an open auction to bidding_db; times are seconds relative to the database clock. */
  addAuction(options?: {
    startsInSeconds?: number;
    endsInSeconds?: number;
    startingPriceCents?: number;
    minIncrementCents?: number;
    reservePriceCents?: number | null;
  }): Promise<string>;
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
  const database = `bidding_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${database}`));

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString(), max: 60 });
  for (const file of readdirSync(SQL_DIR).sort()) {
    await pool.query(readFileSync(join(SQL_DIR, file), 'utf8'));
  }

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

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const logger = createLogger({ service: 'bidding-service-test', level: 'silent' });
  const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
  const biddingService = createBiddingService({ pool, publish, logger });

  return {
    app: createApp({ pool, biddingService, verifyToken, logger }),
    pool,
    published,
    failNextPublish() {
      publishFails = true;
    },
    tokenFor: (userId, roles = ['BIDDER']) =>
      jwt.sign({ roles }, privateKey, {
        algorithm: 'RS256',
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 900,
      }),
    async addAuction(options = {}) {
      const auctionId = randomUUID();
      const ends = options.endsInSeconds ?? 3600;
      await pool.query(
        `INSERT INTO auction_state (auction_id, seller_id, title, currency, starting_price_cents,
           min_increment_cents, reserve_price_cents, starts_at, ends_at, original_ends_at)
         VALUES ($1, $2, 'Test auction', 'EUR', $3, $4, $5,
           now() + make_interval(secs => $6), now() + make_interval(secs => $7),
           now() + make_interval(secs => $7))`,
        [
          auctionId,
          SELLER_ID,
          options.startingPriceCents ?? 1000,
          options.minIncrementCents ?? 100,
          options.reservePriceCents ?? null,
          options.startsInSeconds ?? -60,
          ends,
        ],
      );
      return auctionId;
    },
    async close() {
      // pool.end() can resolve while some connections are still closing, especially after a
      // test that opened many at once. DROP DATABASE ... WITH (FORCE) then terminates them
      // (57P01), and without a listener the pool would report that as an unhandled error.
      pool.on('error', () => {});
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
    },
  };
}
