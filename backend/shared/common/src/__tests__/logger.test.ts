import {
  getCorrelationId,
  resolveCorrelationId,
  runWithCorrelationId,
} from '../logger/correlation';
import { memoryLogger } from './helpers';

describe('createLogger', () => {
  it('writes JSON with the service name, an ISO time and the message', () => {
    const { logger, lines } = memoryLogger();
    logger.info('hello');

    expect(lines()[0]).toMatchObject({ service: 'test-service', msg: 'hello' });
    expect(lines()[0]?.time).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/));
  });

  it('adds the correlation ID inside a context, including after an await', async () => {
    const { logger, lines } = memoryLogger();

    await runWithCorrelationId('abc-123', async () => {
      await new Promise((resolve) => setImmediate(resolve));
      logger.info('inside');
    });
    logger.info('outside');

    expect(lines()[0]?.correlationId).toBe('abc-123');
    expect(lines()[1]).not.toHaveProperty('correlationId');
  });

  it('keeps concurrent contexts apart', async () => {
    const seen = await Promise.all(
      ['a', 'b'].map((id) =>
        runWithCorrelationId(id, async () => {
          await new Promise((resolve) => setImmediate(resolve));
          return getCorrelationId();
        }),
      ),
    );
    expect(seen).toEqual(['a', 'b']);
  });

  it.each([
    ['password', { password: 'secret-value' }],
    ['a nested token', { user: { refreshToken: 'secret-value' } }],
    ['the authorization header', { req: { headers: { authorization: 'secret-value' } } }],
  ])('redacts %s', (_name, fields) => {
    const { logger, lines } = memoryLogger();
    logger.info(fields, 'with secret');

    expect(JSON.stringify(lines()[0])).not.toContain('secret-value');
    expect(JSON.stringify(lines()[0])).toContain('[REDACTED]');
  });
});

describe('resolveCorrelationId', () => {
  it('keeps a safe ID', () => {
    expect(resolveCorrelationId('req_1.2-3')).toBe('req_1.2-3');
  });

  it.each([
    ['a line break (log injection)', 'abc\n{"level":"fatal"}'],
    ['an over-long value', 'x'.repeat(129)],
    ['an empty string', ''],
    ['a non-string', 42],
    ['undefined', undefined],
  ])('replaces %s with a new UUID', (_name, value) => {
    expect(resolveCorrelationId(value)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
