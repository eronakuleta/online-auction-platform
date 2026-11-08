// B-13: health, security headers and request limits of bidding-service.
import { createTokenVerifier } from '@auction/shared-auth';
import { createLogger } from '@auction/shared-common';
import { generateKeyPairSync } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../app';
import { createStreamHub } from '../controllers/stream-hub';
import { createBidQueryService } from '../services/bid-query.service';
import { createBiddingService } from '../services/bidding.service';
import { createIdempotencyService } from '../services/idempotency.service';
import { createLiveUpdates } from '../services/live-updates';
import { createNoStateCache } from '../repositories/state-cache';
import { BIDDER1_ID, LIVE_NO_BIDS_ID, createTestContext, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('GET /health', () => {
  it('answers 200 while the database is reachable', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 in the standard error format when the database is not reachable', async () => {
    // Nothing listens on port 1, so every query fails at once.
    const deadPool = new Pool({ connectionString: 'postgres://nobody:none@127.0.0.1:1/none' });
    deadPool.on('error', () => {});
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const logger = createLogger({ service: 'health-test', level: 'silent' });
    const hub = createStreamHub({ logger });
    const cache = createNoStateCache();
    const live = createLiveUpdates({ deliverLocally: hub.deliver, logger });
    const app = createApp({
      pool: deadPool,
      biddingService: createBiddingService({
        pool: deadPool,
        publish: async () => {
          throw new Error('not used');
        },
        logger,
        antiSniping: { windowSeconds: 30, extensionSeconds: 30, maxExtensions: 10 },
        payment: { checkFunds: async () => 'SUFFICIENT' },
        cache,
        live,
      }),
      idempotency: createIdempotencyService(deadPool),
      queries: createBidQueryService(deadPool, cache),
      hub,
      verifyToken: createTokenVerifier({
        publicKey,
        issuer: 'auction-auth-service',
        audience: 'auction-platform',
      }),
      logger,
    });
    try {
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|nobody/);
    } finally {
      hub.closeAll();
      await deadPool.end();
    }
  });
});

describe('headers and limits', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    // No HSTS: TLS ends at the gateway, and on localhost it would force HTTPS on other projects.
    expect(res.headers['strict-transportation-security']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('puts a request ID in every answer, errors included', async () => {
    const ok = await request(ctx.app).get('/health');
    const missing = await request(ctx.app).get('/api/v1/nothing-here');
    expect(ok.headers['x-request-id']).toBeTruthy();
    expect(missing.status).toBe(404);
    expect(missing.body.error.requestId).toBe(missing.headers['x-request-id']);
  });

  it('refuses a body over 4 kB with 413 before it reaches any route', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/auctions/${LIVE_NO_BIDS_ID}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
      .send({ amountCents: 2000, padding: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses a body that is not valid JSON with 400', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/auctions/${LIVE_NO_BIDS_ID}/bids`)
      .set('Authorization', `Bearer ${ctx.tokenFor(BIDDER1_ID)}`)
      .set('Content-Type', 'application/json')
      .send('{"amountCents":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('does not route /internal/cancel through the public path', async () => {
    // The internal call lives under /internal only (the gateway refuses that prefix).
    const res = await request(ctx.app)
      .post(`/api/v1/auctions/${LIVE_NO_BIDS_ID}/cancel`)
      .send({ cancelledBy: BIDDER1_ID, isAdmin: true });
    expect(res.status).toBe(404);
  });
});
