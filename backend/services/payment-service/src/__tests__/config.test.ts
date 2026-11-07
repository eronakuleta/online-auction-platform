import { loadConfig } from '../config';

const validEnv = {
  PAYMENT_SERVICE_PORT: '3004',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'auction',
  POSTGRES_PASSWORD: 'secret-value',
  PAYMENT_DB_NAME: 'payment_db',
  JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
  JWT_ISSUER: 'auction-auth-service',
  JWT_AUDIENCE: 'auction-platform',
  CURRENCY: 'EUR',
  RABBITMQ_URL: 'amqp://auction:secret-value@rabbitmq:5672',
  EVENTS_EXCHANGE: 'auction.events',
  PLATFORM_FEE_PERCENT: '5',
};

describe('loadConfig', () => {
  it('reads a complete environment and converts numbers', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3004);
    expect(config.database).toMatchObject({ database: 'payment_db', port: 5432 });
    expect(config.currency).toBe('EUR');
    expect(config.events.exchange).toBe('auction.events');
    expect(config.platformFeePercent).toBe(5);
  });

  it('fails fast, names every missing variable, and never prints a value', () => {
    const call = () =>
      loadConfig({ ...validEnv, PAYMENT_DB_NAME: undefined, RABBITMQ_URL: '', CURRENCY: 'euro' });

    expect(call).toThrow(/PAYMENT_DB_NAME, CURRENCY, RABBITMQ_URL/);
    expect(call).not.toThrow(/secret-value/);
  });

  it('needs only the public key', () => {
    expect(JSON.stringify(loadConfig(validEnv).jwt)).not.toMatch(/private/i);
  });
});
