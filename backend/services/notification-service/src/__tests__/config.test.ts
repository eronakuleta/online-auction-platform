// B-16: the service refuses to start with a broken environment, and never prints a secret.
import { loadConfig } from '../config';

const validEnv = {
  NOTIFICATION_SERVICE_PORT: '3005',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'auction',
  POSTGRES_PASSWORD: 'secret-value',
  NOTIFICATION_DB_NAME: 'notification_db',
  JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
  JWT_ISSUER: 'auction-auth-service',
  JWT_AUDIENCE: 'auction-platform',
  RABBITMQ_URL: 'amqp://auction:secret-value@rabbitmq:5672',
  EVENTS_EXCHANGE: 'auction.events',
};

describe('loadConfig', () => {
  it('reads a complete environment and converts numbers', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3005);
    expect(config.database).toMatchObject({ database: 'notification_db', port: 5432 });
    expect(config.events.exchange).toBe('auction.events');
  });

  it('uses auction.events when no exchange is set', () => {
    expect(loadConfig({ ...validEnv, EVENTS_EXCHANGE: undefined }).events.exchange).toBe(
      'auction.events',
    );
  });

  it('fails fast, names every missing variable, and never prints a value', () => {
    const call = () =>
      loadConfig({
        ...validEnv,
        NOTIFICATION_DB_NAME: undefined,
        RABBITMQ_URL: '',
        JWT_ISSUER: '',
      });

    expect(call).toThrow(/NOTIFICATION_DB_NAME, JWT_ISSUER, RABBITMQ_URL/);
    expect(call).not.toThrow(/secret-value/);
  });

  it('refuses a port that is not a number in range', () => {
    expect(() => loadConfig({ ...validEnv, NOTIFICATION_SERVICE_PORT: 'abc' })).toThrow(
      /NOTIFICATION_SERVICE_PORT/,
    );
    expect(() => loadConfig({ ...validEnv, NOTIFICATION_SERVICE_PORT: '70000' })).toThrow(
      /NOTIFICATION_SERVICE_PORT/,
    );
  });

  it('needs only the public key', () => {
    expect(JSON.stringify(loadConfig(validEnv).jwt)).not.toMatch(/private/i);
  });
});
