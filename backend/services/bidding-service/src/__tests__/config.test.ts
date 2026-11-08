// B-13: the service refuses to start with a broken environment, and never prints a secret.
import { loadConfig } from '../config';

const validEnv = {
  BIDDING_SERVICE_PORT: '3003',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'auction',
  POSTGRES_PASSWORD: 'secret-value',
  BIDDING_DB_NAME: 'bidding_db',
  JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
  JWT_ISSUER: 'auction-auth-service',
  JWT_AUDIENCE: 'auction-platform',
  RABBITMQ_URL: 'amqp://auction:secret-value@rabbitmq:5672',
  EVENTS_EXCHANGE: 'auction.events',
  SNIPE_WINDOW_SECONDS: '30',
  SNIPE_EXTENSION_SECONDS: '30',
  MAX_EXTENSIONS: '10',
  PAYMENT_SERVICE_URL: 'http://payment-service:3004',
  FUNDS_CHECK_TIMEOUT_MS: '2000',
  REDIS_URL: 'redis://:secret-value@redis:6379',
};

describe('loadConfig', () => {
  it('reads a complete environment and converts numbers', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3003);
    expect(config.database).toMatchObject({ database: 'bidding_db', port: 5432 });
    expect(config.antiSniping).toEqual({
      windowSeconds: 30,
      extensionSeconds: 30,
      maxExtensions: 10,
    });
    expect(config.payment).toEqual({ url: 'http://payment-service:3004', timeoutMs: 2000 });
  });

  it('has sensible defaults for the optional settings', () => {
    const config = loadConfig({ ...validEnv, EVENTS_EXCHANGE: undefined });
    expect(config.events.exchange).toBe('auction.events');
    expect(config.closing).toEqual({ intervalMs: 1000, batchSize: 50 });
    expect(config.redis.stateTtlSeconds).toBe(30);
  });

  it('fails fast, names every bad variable, and never prints a value', () => {
    const call = () =>
      loadConfig({
        ...validEnv,
        BIDDING_DB_NAME: undefined,
        RABBITMQ_URL: '',
        PAYMENT_SERVICE_URL: 'not a url',
      });

    expect(call).toThrow(/BIDDING_DB_NAME, RABBITMQ_URL, PAYMENT_SERVICE_URL/);
    expect(call).not.toThrow(/secret-value/);
  });

  it('refuses a port outside 1 to 65535', () => {
    for (const bad of ['0', '70000', 'abc']) {
      expect(() => loadConfig({ ...validEnv, BIDDING_SERVICE_PORT: bad })).toThrow(
        /BIDDING_SERVICE_PORT/,
      );
    }
  });

  it('refuses anti-sniping settings that make no sense', () => {
    expect(() => loadConfig({ ...validEnv, SNIPE_EXTENSION_SECONDS: '0' })).toThrow(
      /SNIPE_EXTENSION_SECONDS/,
    );
    expect(() => loadConfig({ ...validEnv, MAX_EXTENSIONS: '-1' })).toThrow(/MAX_EXTENSIONS/);
    expect(() => loadConfig({ ...validEnv, SNIPE_WINDOW_SECONDS: '1.5' })).toThrow(
      /SNIPE_WINDOW_SECONDS/,
    );
  });

  it('allows switching anti-sniping off with a window or a cap of zero', () => {
    expect(loadConfig({ ...validEnv, MAX_EXTENSIONS: '0' }).antiSniping.maxExtensions).toBe(0);
    expect(loadConfig({ ...validEnv, SNIPE_WINDOW_SECONDS: '0' }).antiSniping.windowSeconds).toBe(
      0,
    );
  });

  it('needs only the public key', () => {
    expect(JSON.stringify(loadConfig(validEnv).jwt)).not.toMatch(/private/i);
  });
});
