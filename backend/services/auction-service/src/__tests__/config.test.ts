import { loadConfig } from '../config';

const validEnv = {
  AUCTION_SERVICE_PORT: '3002',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'auction',
  POSTGRES_PASSWORD: 'secret-value',
  AUCTION_DB_NAME: 'auction_db',
  JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
  JWT_ISSUER: 'auction-auth-service',
  JWT_AUDIENCE: 'auction-platform',
  CURRENCY: 'EUR',
  BIDDING_SERVICE_URL: 'http://bidding-service:3003',
  BIDDING_CANCEL_TIMEOUT_MS: '2000',
  RABBITMQ_URL: 'amqp://auction:secret-value@rabbitmq:5672',
  EVENTS_EXCHANGE: 'auction.events',
};

describe('loadConfig', () => {
  it('reads a complete environment and converts numbers', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3002);
    expect(config.database.database).toBe('auction_db');
    expect(config.bidding).toEqual({ url: 'http://bidding-service:3003', timeoutMs: 2000 });
  });

  it('reads the RabbitMQ settings, and never prints the URL with its password', () => {
    expect(loadConfig(validEnv).events).toEqual({
      rabbitmqUrl: 'amqp://auction:secret-value@rabbitmq:5672',
      exchange: 'auction.events',
    });

    const call = () => loadConfig({ ...validEnv, RABBITMQ_URL: '', EVENTS_EXCHANGE: undefined });
    expect(call).toThrow(/RABBITMQ_URL, EVENTS_EXCHANGE/);
    expect(call).not.toThrow(/secret-value/);
  });

  it('fails fast and names every missing variable', () => {
    const incomplete = { ...validEnv, CURRENCY: undefined, BIDDING_SERVICE_URL: undefined };

    expect(() => loadConfig(incomplete)).toThrow(/CURRENCY, BIDDING_SERVICE_URL/);
  });

  it('needs only the public key, and does not print values', () => {
    expect(JSON.stringify(loadConfig(validEnv).jwt)).not.toMatch(/private/i);

    const call = () => loadConfig({ ...validEnv, AUCTION_SERVICE_PORT: 'abc' });
    expect(call).toThrow(/AUCTION_SERVICE_PORT/);
    expect(call).not.toThrow(/secret-value/);
  });

  it('rejects a currency that is not a 3-letter code', () => {
    expect(() => loadConfig({ ...validEnv, CURRENCY: 'euro' })).toThrow(/CURRENCY/);
  });
});
