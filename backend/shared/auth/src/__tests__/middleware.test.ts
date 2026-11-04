import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  correlationMiddleware,
  createErrorHandler,
  createLogger,
  notFoundHandler,
} from '@auction/shared-common';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authenticate, createTokenVerifier, getAuthUser, requireRole, type Role } from '../index';

const ISSUER = 'auction-auth-service';
const AUDIENCE = 'auction-platform';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const verifyToken = createTokenVerifier({ publicKey, issuer: ISSUER, audience: AUDIENCE });
const logger = createLogger({ service: 'test', level: 'silent' });
const userId = randomUUID();

function tokenWith(roles: Role[], options: jwt.SignOptions = {}): string {
  return jwt.sign({ sub: userId, roles }, privateKey, {
    algorithm: 'RS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: 900,
    ...options,
  });
}

function buildApp() {
  const app = express();
  app.use(correlationMiddleware());
  app.get('/me', authenticate(verifyToken), (req, res) => {
    res.json(getAuthUser(req));
  });
  app.post('/auctions', authenticate(verifyToken), requireRole('SELLER'), (_req, res) => {
    res.status(201).end();
  });
  app.get('/reports', authenticate(verifyToken), requireRole('SELLER', 'ADMIN'), (_req, res) => {
    res.status(200).end();
  });
  app.get('/forgot-authenticate', requireRole('ADMIN'), (_req, res) => {
    res.status(200).end();
  });
  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));
  return app;
}

const app = buildApp();

function expectStandardError(
  response: request.Response,
  status: number,
  code: string,
  message: string,
): void {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({
    error: { code, message, details: [], requestId: response.headers['x-request-id'] },
  });
}

describe('authenticate', () => {
  it('attaches the caller for a valid token', async () => {
    const response = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${tokenWith(['BIDDER', 'SELLER'])}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: userId, roles: ['BIDDER', 'SELLER'] });
  });

  it.each([
    ['no header', undefined],
    ['another scheme', `Basic ${tokenWith(['BIDDER'])}`],
    ['a malformed token', 'Bearer not-a-jwt'],
    ['an expired token', `Bearer ${tokenWith(['BIDDER'], { expiresIn: -60 })}`],
    ['a token from another issuer', `Bearer ${tokenWith(['BIDDER'], { issuer: 'other' })}`],
  ])('answers the same generic 401 for %s', async (_case, header) => {
    const call = request(app).get('/me');
    const response = await (header ? call.set('Authorization', header) : call);

    expectStandardError(response, 401, 'UNAUTHORIZED', 'Authentication required');
  });

  it('answers 401 for a token signed with another key', async () => {
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = jwt.sign({ sub: userId, roles: ['ADMIN'] }, attacker.privateKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: 900,
    });

    const response = await request(app).get('/me').set('Authorization', `Bearer ${forged}`);

    expectStandardError(response, 401, 'UNAUTHORIZED', 'Authentication required');
  });

  it('passes an unexpected verifier error on as a 500, not a 401', async () => {
    const broken = express();
    broken.use(correlationMiddleware());
    broken.get(
      '/me',
      authenticate(() => {
        throw new Error('verifier bug');
      }),
      (_req, res) => {
        res.status(200).end();
      },
    );
    broken.use(createErrorHandler(logger));

    const response = await request(broken)
      .get('/me')
      .set('Authorization', `Bearer ${tokenWith(['BIDDER'])}`);

    expectStandardError(response, 500, 'INTERNAL_ERROR', 'Something went wrong');
  });
});

describe('requireRole', () => {
  it('allows a user with the role', async () => {
    const response = await request(app)
      .post('/auctions')
      .set('Authorization', `Bearer ${tokenWith(['BIDDER', 'SELLER'])}`);

    expect(response.status).toBe(201);
  });

  it('allows a user with any one of several roles', async () => {
    const response = await request(app)
      .get('/reports')
      .set('Authorization', `Bearer ${tokenWith(['ADMIN'])}`);

    expect(response.status).toBe(200);
  });

  it('answers 403 for a user without the role', async () => {
    const response = await request(app)
      .post('/auctions')
      .set('Authorization', `Bearer ${tokenWith(['BIDDER'])}`);

    expectStandardError(response, 403, 'FORBIDDEN', 'You are not allowed to do this');
  });

  it('answers 401, not 403, when there is no token', async () => {
    const response = await request(app).post('/auctions');

    expectStandardError(response, 401, 'UNAUTHORIZED', 'Authentication required');
  });

  it('fails closed with 401 if authenticate() was forgotten on the route', async () => {
    const response = await request(app).get('/forgot-authenticate');

    expectStandardError(response, 401, 'UNAUTHORIZED', 'Authentication required');
  });

  it('refuses to be set up without roles, so a route is never accidentally open', () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });
});
