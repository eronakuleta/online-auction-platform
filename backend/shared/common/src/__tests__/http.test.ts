import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../errors/app-error';
import { getCorrelationId } from '../logger/correlation';
import {
  correlationMiddleware,
  createErrorHandler,
  notFoundHandler,
  requestLogger,
} from '../http/middleware';
import { memoryLogger } from './helpers';

function buildApp() {
  const { logger, lines } = memoryLogger();
  const app = express();
  app.use(correlationMiddleware());
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '1kb' }));

  app.get('/ok', (_req, res) => {
    res.json({ correlationId: getCorrelationId() });
  });
  app.get('/async-conflict', async () => {
    await new Promise((resolve) => setImmediate(resolve));
    throw new ConflictError('BID_TOO_LOW', 'Bid must be at least 12500');
  });
  app.post('/validate', (req, res) => {
    const body = z.object({ amountCents: z.int().positive() }).parse(req.body);
    res.json(body);
  });
  app.get('/bug', () => {
    throw new Error('database password is hunter2');
  });

  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return { app, lines };
}

describe('correlationMiddleware', () => {
  it('creates an ID and exposes it in the header and the request context', async () => {
    const res = await request(buildApp().app).get('/ok').expect(200);

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  });

  it('reuses a safe incoming ID, so one ID follows the request across services', async () => {
    const res = await request(buildApp().app).get('/ok').set('X-Request-Id', 'from-gateway-1');
    expect(res.headers['x-request-id']).toBe('from-gateway-1');
  });

  it('replaces an unsafe incoming ID', async () => {
    const res = await request(buildApp().app).get('/ok').set('X-Request-Id', 'bad id with spaces');
    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
  });
});

describe('requestLogger', () => {
  it('logs the request without its query string', async () => {
    const { app, lines } = buildApp();
    const res = await request(app).get('/ok?email=private@example.com');

    const line = lines().find((entry) => entry.msg === 'request finished');
    expect(line).toMatchObject({
      method: 'GET',
      path: '/ok',
      status: 200,
      correlationId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(line)).not.toContain('private@example.com');
  });
});

describe('createErrorHandler', () => {
  it('sends the standard body for an AppError thrown in an async route', async () => {
    const res = await request(buildApp().app).get('/async-conflict').expect(409);

    expect(res.body).toEqual({
      error: {
        code: 'BID_TOO_LOW',
        message: 'Bid must be at least 12500',
        details: [],
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('turns a ZodError into a 400 listing the bad fields', async () => {
    const res = await request(buildApp().app)
      .post('/validate')
      .send({ amountCents: 10.5 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ path: 'amountCents', message: expect.any(String) }]);
  });

  it('answers 400 for malformed JSON', async () => {
    const res = await request(buildApp().app)
      .post('/validate')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('answers 413 for a body over the limit', async () => {
    const res = await request(buildApp().app)
      .post('/validate')
      .send({ filler: 'x'.repeat(2000) })
      .expect(413);

    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides unexpected errors from the client and logs them', async () => {
    const { app, lines } = buildApp();
    const res = await request(app).get('/bug').expect(500);

    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    const logged = lines().find((entry) => entry.msg === 'request failed');
    expect(logged?.level).toBe(50);
    expect(JSON.stringify(logged)).toContain('hunter2');
  });

  it('answers the standard 404 for an unknown route', async () => {
    const res = await request(buildApp().app).get('/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    [new ValidationError(), 400, 'VALIDATION_ERROR'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new TooManyRequestsError(), 429, 'RATE_LIMITED'],
    [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE'],
  ])('%s has the documented status and code', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });

  it('lets a service use its own code', () => {
    expect(new NotFoundError('No such auction', 'AUCTION_NOT_FOUND').code).toBe(
      'AUCTION_NOT_FOUND',
    );
  });
});
