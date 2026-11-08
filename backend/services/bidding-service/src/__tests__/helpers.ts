// Test setup: a real Postgres with a throwaway database per test file, built from the same SQL
// files as production, real RS256 tokens, a fake publisher that records events, and a real HTTP
// server standing in for payment-service's funds check.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createTokenVerifier, type Role } from '@auction/shared-auth';
import { createEvent, createLogger, type DomainEvent, type Publish } from '@auction/shared-common';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { Client, Pool } from 'pg';
import { createApp } from '../app';
import { createPaymentClient } from '../clients/payment.client';
import { createStreamHub, type StreamHub } from '../controllers/stream-hub';
import { createReplicaPublisher, subscribeToLiveUpdates } from '../repositories/live-channel';
import { createBidQueryService } from '../services/bid-query.service';
import { createBiddingService } from '../services/bidding.service';
import { createClosingService, type ClosingService } from '../services/closing.service';
import { createIdempotencyService } from '../services/idempotency.service';
import { createLiveUpdates, type LiveUpdates } from '../services/live-updates';
import { createNoStateCache, type StateCache } from '../repositories/state-cache';

// The default is the Docker Compose Postgres from .env.example. CI sets its own service container.
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://auction:change-me-postgres@localhost:5433/postgres';
const SQL_DIR = join(__dirname, '../../../../../database/bidding');
const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';

/** The .env.example defaults: a bid in the last 30 s adds 30 s, at most 10 times. */
export const ANTI_SNIPING = { windowSeconds: 30, extensionSeconds: 30, maxExtensions: 10 };

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

/** How the fake payment-service answers a funds check. */
export type FundsAnswer = 'sufficient' | 'insufficient' | 'no-wallet' | 'error' | 'hang';

/** One bidding-service replica on the shared test database. */
export interface Replica {
  app: Express;
  hub: StreamHub;
  live: LiveUpdates;
  /** Starts a real HTTP server (SSE needs one) and returns its base URL. Closed by close(). */
  listen(): Promise<string>;
}

export interface TestContext extends Replica {
  /** Another replica on the same database, with its own hub (and Redis subscriber, if any). */
  newReplica(): Promise<Replica>;
  pool: Pool;
  /** Events published so far. Built with createEvent, so they are checked against the contract. */
  published: DomainEvent[];
  /** Makes the next publish fail, as if the broker were down. */
  failNextPublish(): void;
  tokenFor(userId: string, roles?: Role[]): string;
  /** Sets the fake payment-service's answers, in order; then it answers 'sufficient' again. */
  answerFundsCheck(...answers: FundsAnswer[]): void;
  /** Every funds check the fake payment-service received. */
  fundsChecks: { userId: string; amountCents: number }[];
  /** A closing service on the same database (batch size 50), as each replica would have. */
  newClosingService(batchSize?: number): ClosingService;
  /** Moves the auction's end time 1 s into the past, as if it had just ended. */
  expireAuction(auctionId: string): Promise<void>;
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

export async function createTestContext(
  options: { cache?: StateCache; redisUrl?: string; heartbeatMs?: number } = {},
): Promise<TestContext> {
  const cache = options.cache ?? createNoStateCache();
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

  const fundsChecks: { userId: string; amountCents: number }[] = [];
  let fundsAnswers: FundsAnswer[] = [];
  const hanging: { destroy(): void }[] = [];
  const fakePayment = createServer((req, res) => {
    const query = new URL(req.url ?? '/', 'http://fake').searchParams;
    const userId = query.get('userId') ?? '';
    const amountCents = Number(query.get('amountCents'));
    fundsChecks.push({ userId, amountCents });
    const answer = fundsAnswers.shift() ?? 'sufficient';
    if (answer === 'hang') {
      hanging.push(res);
      return;
    }
    const [status, body] =
      answer === 'no-wallet'
        ? [404, { error: { code: 'WALLET_NOT_FOUND', message: 'no wallet', details: [] } }]
        : answer === 'error'
          ? [500, { error: { code: 'INTERNAL_ERROR', message: 'boom', details: [] } }]
          : [200, { userId, amountCents, balanceCents: 0, sufficient: answer === 'sufficient' }];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => fakePayment.listen(0, '127.0.0.1', resolve));
  const { port } = fakePayment.address() as AddressInfo;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const logger = createLogger({ service: 'bidding-service-test', level: 'silent' });
  const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
  const payment = createPaymentClient({
    baseUrl: `http://127.0.0.1:${port}`,
    timeoutMs: 300,
    logger,
  });
  // Live updates (B-12). With a Redis URL each replica publishes through Redis and has its own
  // subscriber, exactly like production; without one, updates go straight to the local hub.
  const redisClients: { close(): Promise<unknown> }[] = [];
  const redisPublisher = options.redisUrl
    ? createClient({ url: options.redisUrl, disableOfflineQueue: true })
    : undefined;
  if (redisPublisher) {
    await redisPublisher.connect();
    redisClients.push(redisPublisher);
  }
  const servers: Server[] = [];
  const hubs: StreamHub[] = [];

  async function buildReplica(): Promise<Replica> {
    const hub = createStreamHub({ logger, heartbeatMs: options.heartbeatMs });
    hubs.push(hub);
    if (redisPublisher) {
      const subscriber = redisPublisher.duplicate();
      await subscriber.connect();
      redisClients.push(subscriber);
      await subscribeToLiveUpdates(subscriber, hub.deliver, () => {});
    }
    const live = createLiveUpdates({
      deliverLocally: hub.deliver,
      publishToReplicas: redisPublisher ? createReplicaPublisher(redisPublisher) : undefined,
      logger,
    });
    const biddingService = createBiddingService({
      pool,
      publish,
      logger,
      antiSniping: ANTI_SNIPING,
      payment,
      cache,
      live,
    });
    const app = createApp({
      pool,
      biddingService,
      idempotency: createIdempotencyService(pool),
      queries: createBidQueryService(pool, cache),
      hub,
      verifyToken,
      logger,
    });
    return {
      app,
      hub,
      live,
      async listen() {
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve) => server.once('listening', () => resolve()));
        servers.push(server);
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      },
    };
  }

  const primary = await buildReplica();

  return {
    app: primary.app,
    hub: primary.hub,
    live: primary.live,
    listen: primary.listen,
    newReplica: buildReplica,
    fundsChecks,
    answerFundsCheck(...answers) {
      fundsAnswers = answers;
    },
    pool,
    published,
    failNextPublish() {
      publishFails = true;
    },
    newClosingService: (batchSize = 50) =>
      createClosingService({ pool, publish, logger, batchSize, cache, live: primary.live }),
    async expireAuction(auctionId) {
      await pool.query(
        `UPDATE auction_state
         SET ends_at = now() - interval '1 second', original_ends_at = now() - interval '1 second',
             extension_count = 0
         WHERE auction_id = $1`,
        [auctionId],
      );
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
      hubs.forEach((hub) => hub.closeAll());
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await Promise.allSettled(redisClients.map((client) => client.close()));
      hanging.forEach((res) => res.destroy());
      fakePayment.closeAllConnections();
      await new Promise((resolve) => fakePayment.close(resolve));
      await pool.end();
      await withAdminClient((client) => client.query(`DROP DATABASE ${database} WITH (FORCE)`));
    },
  };
}
