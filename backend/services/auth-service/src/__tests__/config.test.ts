import { loadConfig } from '../config';

const validEnv = {
  AUTH_SERVICE_PORT: '3001',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'auction',
  POSTGRES_PASSWORD: 'secret-value',
  AUTH_DB_NAME: 'auth_db',
  JWT_PRIVATE_KEY_PATH: '/run/secrets/jwt_private.pem',
  JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt_public.pem',
  JWT_ISSUER: 'auction-auth-service',
  JWT_AUDIENCE: 'auction-platform',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '604800',
  LOGIN_MAX_FAILED_ATTEMPTS: '5',
  LOGIN_LOCK_SECONDS: '300',
  RABBITMQ_URL: 'amqp://auction:secret-value@rabbitmq:5672',
  EVENTS_EXCHANGE: 'auction.events',
};

describe('loadConfig', () => {
  it('reads a complete environment and converts numbers', () => {
    const config = loadConfig(validEnv);

    expect(config.port).toBe(3001);
    expect(config.database.database).toBe('auth_db');
    expect(config.jwt.accessTtlSeconds).toBe(900);
  });

  it('fails fast and names every missing variable', () => {
    const incomplete = { ...validEnv, POSTGRES_PASSWORD: undefined, JWT_ISSUER: undefined };

    expect(() => loadConfig(incomplete)).toThrow(/POSTGRES_PASSWORD, JWT_ISSUER/);
  });

  it('rejects a port that is not a number, without printing values', () => {
    const call = () => loadConfig({ ...validEnv, AUTH_SERVICE_PORT: 'abc' });

    expect(call).toThrow(/AUTH_SERVICE_PORT/);
    expect(call).not.toThrow(/secret-value/);
  });
});
