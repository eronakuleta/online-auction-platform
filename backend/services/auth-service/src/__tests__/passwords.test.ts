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
    // The first unknown-email lookup creates the dummy hash; measure the ones after it.
    await passwordMatches(undefined, 'anything');

    const timings: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const started = process.hrtime.bigint();
      expect(await passwordMatches(undefined, 'Correct#Horse9')).toBe(false);
      timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    }

    // Not a precise timing test: it proves an argon2 verify really ran, so an unknown email is not
    // answered visibly faster. A real verify takes tens of milliseconds; a plain "return false"
    // takes well under one. The fastest of three runs is used, so a slow, busy CI machine can only
    // make it pass more clearly, never fail it. (An earlier version compared two timings with each
    // other, and one pause on a busy machine could break that ratio.)
    expect(Math.min(...timings)).toBeGreaterThan(5);
  });
});
