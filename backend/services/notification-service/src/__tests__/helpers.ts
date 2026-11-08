// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL
// files as production. Events are built with createEvent, so they are checked against the contract.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEvent, createLogger, type DomainEvent } from '@auction/shared-common';
import { Client, Pool } from 'pg';
import { createNotificationHandlers } from '../events/notification.consumer';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/notification');

/** From database/auth/002_seed.sql and database/auction/002_seed.sql. */
export const SELLER_ID = '00000000-0000-4000-8000-000000000002';
export const BIDDER1_ID = '00000000-0000-4000-8000-000000000003';
export const BIDDER2_ID = '00000000-0000-4000-8000-000000000004';
export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const CAMERA_ID = '10000000-0000-4000-8000-000000000001';

export interface StoredNotification {
  user_id: string;
  type: string;
  title: string;
  message: string;
  auction_id: string | null;
  read_at: Date | null;
  event_id: string;
}

export interface TestContext {
  pool: Pool;
  handlers: ReturnType<typeof createNotificationHandlers>;
  /** The stored notifications of one user, oldest first. */
  notificationsOf(userId: string): Promise<StoredNotification[]>;
  count(): Promise<number>;
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
  const database = `notification_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${database}`));

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString() });
  for (const file of readdirSync(SQL_DIR).sort()) {
    await pool.query(readFileSync(join(SQL_DIR, file), 'utf8'));
  }

  const logger = createLogger({ service: 'notification-service-test', level: 'silent' });
  return {
    pool,
    handlers: createNotificationHandlers({ pool, logger }),
    async notificationsOf(userId) {
      const result = await pool.query<StoredNotification>(
        `SELECT user_id, type, title, message, auction_id, read_at, event_id FROM notifications
         WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return result.rows;
    },
    async count() {
      const result = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM notifications',
      );
      return result.rows[0]!.n;
    },
    async close() {
      // Same reason as in bidding-service: pool.end() can resolve while connections still close.
      pool.on('error', () => {});
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
    },
  };
}

const now = () => new Date().toISOString();

export function userRegistered(userId = randomUUID(), displayName = 'Test User') {
  return createEvent('user.registered', { userId, displayName }) as DomainEvent<'user.registered'>;
}

export function bidPlaced(overrides: Record<string, unknown> = {}) {
  return createEvent('bid.placed', {
    bidId: randomUUID(),
    auctionId: CAMERA_ID,
    title: 'Vintage 35mm film camera',
    bidderId: BIDDER2_ID,
    amountCents: 6000,
    currency: 'EUR',
    previousHighestBidderId: BIDDER1_ID,
    placedAt: now(),
    ...overrides,
  }) as DomainEvent<'bid.placed'>;
}

export function auctionSold(overrides: Record<string, unknown> = {}) {
  return createEvent('auction.closed', {
    auctionId: CAMERA_ID,
    sellerId: SELLER_ID,
    title: 'Vintage 35mm film camera',
    currency: 'EUR',
    closedAt: now(),
    losingBidderIds: [BIDDER1_ID],
    result: 'SOLD',
    winnerId: BIDDER2_ID,
    amountCents: 8500,
    ...overrides,
  }) as DomainEvent<'auction.closed'>;
}

export function auctionNoSale(
  noSaleReason: 'NO_BIDS' | 'RESERVE_NOT_MET',
  losingBidderIds: string[] = [],
) {
  return createEvent('auction.closed', {
    auctionId: CAMERA_ID,
    sellerId: SELLER_ID,
    title: 'Vintage 35mm film camera',
    currency: 'EUR',
    closedAt: now(),
    losingBidderIds,
    result: 'NO_SALE',
    noSaleReason,
  }) as DomainEvent<'auction.closed'>;
}

export function auctionCancelled(cancelledBy: string) {
  return createEvent('auction.cancelled', {
    auctionId: CAMERA_ID,
    sellerId: SELLER_ID,
    title: 'Vintage 35mm film camera',
    cancelledBy,
  }) as DomainEvent<'auction.cancelled'>;
}

export function paymentCompleted() {
  return createEvent('payment.completed', {
    settlementId: randomUUID(),
    auctionId: CAMERA_ID,
    title: 'Vintage 35mm film camera',
    winnerId: BIDDER2_ID,
    sellerId: SELLER_ID,
    amountCents: 8500,
    feeCents: 425,
    sellerCents: 8075,
    currency: 'EUR',
    settledAt: now(),
  }) as DomainEvent<'payment.completed'>;
}

export function paymentFailed(reason: 'INSUFFICIENT_FUNDS' | 'WALLET_NOT_FOUND') {
  return createEvent('payment.failed', {
    auctionId: CAMERA_ID,
    title: 'Vintage 35mm film camera',
    winnerId: BIDDER2_ID,
    sellerId: SELLER_ID,
    amountCents: 8500,
    currency: 'EUR',
    reason,
    failedAt: now(),
  }) as DomainEvent<'payment.failed'>;
}
