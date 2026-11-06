// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL
// files as production, a real HTTP server standing in for bidding-service's internal endpoint, and
// a publisher that records events instead of sending them (the broker itself is covered by the
// end-to-end test in tests/e2e/auction-events.e2e.mjs).
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { createBiddingClient } from '../clients/bidding.client';
import { createEventHandlers } from '../events/consumers';
import { createAuctionEventService } from '../services/auction-event.service';
import { createAuctionService } from '../services/auction.service';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/auction');
const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';

/** From database/auth/002_seed.sql and database/auction/002_seed.sql. */
export const DEMO_SELLER_ID = '00000000-0000-4000-8000-000000000002';
export const CATEGORY_ID = '20000000-0000-4000-8000-000000000001';
export const OTHER_CATEGORY_ID = '20000000-0000-4000-8000-000000000002';
export const SEEDED_LIVE_ID = '10000000-0000-4000-8000-000000000001';
export const SEEDED_DRAFT_ID = '10000000-0000-4000-8000-000000000004';
export const SEEDED_CLOSED_ID = '10000000-0000-4000-8000-000000000006';

export interface BiddingCall {
  auctionId: string;
  body: { cancelledBy: string; isAdmin: boolean };
  requestId: string | undefined;
}

export interface BiddingAnswer {
  status: number;
  body?: unknown;
  /** Runs before answering, to simulate something happening while the call is in progress. */
  before?: () => Promise<void>;
  /** Never answer, so the client's timeout has to fire. */
  hang?: boolean;
}

export interface TestContext {
  app: Express;
  pool: Pool;
  /** Every call received by the fake bidding-service. */
  biddingCalls: BiddingCall[];
  /** Sets the fake bidding-service's next answers. The default is 204. */
  answerNextCancel(answer: BiddingAnswer): void;
  /** Every event the service published, in order, already checked against the contract. */
  published: DomainEvent[];
  /** Makes publish() throw, as it does when the broker is down. */
  failPublishing(fail: boolean): void;
  /** Runs inside every publish() call, before it returns, to look at the database at that moment. */
  onPublish(hook: ((event: DomainEvent) => Promise<void>) | undefined): void;
  /** The real handlers the RabbitMQ consumer calls, so tests can deliver events directly. */
  handlers: Required<EventHandlers<'auction-service'>>;
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
  const database = `auction_test_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${database}`));

  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString() });
  for (const file of readdirSync(SQL_DIR).sort()) {
    await pool.query(readFileSync(join(SQL_DIR, file), 'utf8'));
  }

  const biddingCalls: BiddingCall[] = [];
  let nextAnswer: BiddingAnswer = { status: 204 };
  const hanging: { destroy(): void }[] = [];
  const fakeBidding: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const answer = nextAnswer;
      nextAnswer = { status: 204 };
      biddingCalls.push({
        auctionId: req.url?.split('/')[3] ?? '',
        body: JSON.parse(raw) as BiddingCall['body'],
        requestId: req.headers['x-request-id'] as string | undefined,
      });
      if (answer.hang) {
        hanging.push(res);
        return;
      }
      void (answer.before?.() ?? Promise.resolve()).then(() => {
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
      });
    });
  });
  await new Promise<void>((resolve) => fakeBidding.listen(0, '127.0.0.1', resolve));
  const { port } = fakeBidding.address() as AddressInfo;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const logger = createLogger({ service: 'auction-service-test', level: 'silent' });
  const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
  const bidding = createBiddingClient({
    baseUrl: `http://127.0.0.1:${port}`,
    timeoutMs: 300,
    logger,
  });
  const published: DomainEvent[] = [];
  let publishFails = false;
  let publishHook: ((event: DomainEvent) => Promise<void>) | undefined;
  // createEvent validates the payload against the shared contract and throws if it breaks it, the
  // same check the real publisher makes before sending.
  const publish: Publish = async (type, payload) => {
    if (publishFails) {
      throw new Error('broker unavailable');
    }
    const event = createEvent(type, payload);
    // TypeScript cannot narrow the generic DomainEvent<T> to the union; the value is the same.
    published.push(event as DomainEvent);
    await publishHook?.(event as DomainEvent);
    return event;
  };
  const auctionService = createAuctionService({ pool, bidding, currency: 'EUR', publish, logger });
  const handlers = createEventHandlers(createAuctionEventService({ pool, logger }));

  return {
    app: createApp({ pool, auctionService, verifyToken, logger }),
    pool,
    biddingCalls,
    answerNextCancel(answer) {
      nextAnswer = answer;
    },
    published,
    failPublishing(fail) {
      publishFails = fail;
    },
    onPublish(hook) {
      publishHook = hook;
    },
    handlers,
    tokenFor: (roles, userId = randomUUID()) =>
      jwt.sign({ roles }, privateKey, {
        algorithm: 'RS256',
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        expiresIn: 900,
      }),
    async close() {
      hanging.forEach((res) => res.destroy());
      fakeBidding.closeAllConnections();
      await new Promise((resolve) => fakeBidding.close(resolve));
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
    },
  };
}

/** A valid body for POST /auctions: starts in an hour, ends in a day. */
export function newAuction(overrides: Record<string, unknown> = {}) {
  const hour = 3_600_000;
  return {
    categoryId: CATEGORY_ID,
    title: 'Test auction',
    description: 'A thing for sale',
    startingPriceCents: 1000,
    minIncrementCents: 100,
    reservePriceCents: 2000,
    startsAt: new Date(Date.now() + hour).toISOString(),
    endsAt: new Date(Date.now() + 24 * hour).toISOString(),
    imageUrls: ['https://images.test/one.png', 'https://images.test/two.png'],
    ...overrides,
  };
}
