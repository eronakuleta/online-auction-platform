// Task A-15: edge cases the other files do not cover. Exact limits are accepted (the other files
// test one step over them), and the health check reports a database that cannot be reached.
import { generateKeyPairSync } from 'node:crypto';
import { createLogger } from '@auction/shared-common';
import { createTokenVerifier } from '@auction/shared-auth';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../app';
import { createBiddingClient } from '../clients/bidding.client';
import { createAuctionService } from '../services/auction.service';
import { createCategoryService } from '../services/category.service';
import { createTestContext, newAuction, type TestContext } from './helpers';

let ctx: TestContext;
let sellerToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  sellerToken = ctx.tokenFor(['SELLER']);
});

afterAll(async () => {
  await ctx.close();
});

function create(body: object) {
  return request(ctx.app)
    .post('/api/v1/auctions')
    .set({ Authorization: `Bearer ${sellerToken}` })
    .send(body);
}

describe('limits are accepted exactly at the edge', () => {
  it('a title of 3 and of 120 characters (after trimming)', async () => {
    await create(newAuction({ title: '  abc  ' })).expect(201);
    const long = await create(newAuction({ title: 't'.repeat(120) }));

    expect(long.status).toBe(201);
    expect(long.body.title).toHaveLength(120);
  });

  it('a description of 5000 characters and exactly 10 images', async () => {
    const imageUrls = Array.from({ length: 10 }, (_, i) => `https://images.test/${i}.png`);

    const response = await create(newAuction({ description: 'd'.repeat(5000), imageUrls }));

    expect(response.status).toBe(201);
    expect(response.body.imageUrls).toEqual(imageUrls);
  });

  it('prices of 1 cent, and the largest safe integer, stored without losing a cent', async () => {
    const response = await create(
      newAuction({
        startingPriceCents: 1,
        minIncrementCents: 1,
        reservePriceCents: Number.MAX_SAFE_INTEGER,
      }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      startingPriceCents: 1,
      minIncrementCents: 1,
      reservePriceCents: Number.MAX_SAFE_INTEGER,
    });
  });

  it('an end time one second after the start', async () => {
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(startsAt.getTime() + 1000);

    await create(
      newAuction({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
    ).expect(201);
  });

  it('a search term of exactly 100 characters, but not 101', async () => {
    await request(ctx.app)
      .get(`/api/v1/auctions?q=${'w'.repeat(100)}`)
      .expect(200);
    await request(ctx.app)
      .get(`/api/v1/auctions?q=${'w'.repeat(101)}`)
      .expect(400);
  });
});

describe('GET /health without a database', () => {
  it('answers 503 SERVICE_UNAVAILABLE, so Docker marks the container unhealthy', async () => {
    // Port 1 has nothing listening, so every query fails quickly.
    const deadPool = new Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 500 });
    const logger = createLogger({ service: 'auction-service-test', level: 'silent' });
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const app = createApp({
      pool: deadPool,
      auctionService: createAuctionService({
        pool: deadPool,
        bidding: createBiddingClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100, logger }),
        currency: 'EUR',
        publish: () => Promise.reject(new Error('not used')),
        logger,
      }),
      categoryService: createCategoryService({ pool: deadPool, logger }),
      verifyToken: createTokenVerifier({ publicKey, issuer: 'x', audience: 'y' }),
      logger,
    });

    try {
      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      // The answer names no host, port or driver error: those stay in the log.
      expect(JSON.stringify(response.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|port/i);
    } finally {
      await deadPool.end();
    }
  });
});
