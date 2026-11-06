// Unit tests for password hashing (task A-09). No database: only the argon2 helpers.
import { hashPassword, passwordMatches } from '../services/passwords';

describe('hashPassword', () => {
  it('produces an argon2id hash that does not contain the password', async () => {
    const hash = await hashPassword('Correct#Horse9');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Correct#Horse9');
  });

  it('salts every hash, so the same password never gives the same hash twice', async () => {
    const [first, second] = await Promise.all([
      hashPassword('Same#Password1'),
      hashPassword('Same#Password1'),
    ]);

    expect(first).not.toBe(second);
  });
});

describe('passwordMatches', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('Correct#Horse9');

    await expect(passwordMatches(hash, 'Correct#Horse9')).resolves.toBe(true);
    await expect(passwordMatches(hash, 'correct#horse9')).resolves.toBe(false);
    await expect(passwordMatches(hash, '')).resolves.toBe(false);
  });

  it('refuses every password when there is no user, but still does the slow check', async () => {
    const hash = await hashPassword('Warm#Up12');
    const timed = async (work: () => Promise<boolean>) => {
      const started = process.hrtime.bigint();
      const result = await work();
      return { result, ms: Number(process.hrtime.bigint() - started) / 1e6 };
    };
    // The first unknown-email lookup creates the dummy hash; measure the ones after it.
    await passwordMatches(undefined, 'anything');

    const unknown = await timed(() => passwordMatches(undefined, 'Correct#Horse9'));
    const known = await timed(() => passwordMatches(hash, 'Correct#Horse9'));

    expect(unknown.result).toBe(false);
    // Not a precise timing test: it only proves an argon2 verify really ran (a plain "return false"
    // takes well under a millisecond), so an unknown email is not answered visibly faster.
    expect(unknown.ms).toBeGreaterThan(known.ms / 4);
  });
});
