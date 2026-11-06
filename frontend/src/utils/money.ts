// The one place that turns integer cents into a display string.
// It builds an exact decimal string ("1234.05") instead of dividing by 100,
// so no floating-point value is ever created for money.

/**
 * Reads what a user typed ("12", "12.5", "12.50") as integer cents, without ever making a float.
 * Returns null for anything else (more than 2 decimals, letters, negative numbers, empty).
 */
export function parseMoneyToCents(input: string): number | null {
  const match = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number((match[2] ?? '').padEnd(2, '0'));
  return major * 100 + minor;
}

/** The opposite of parseMoneyToCents, for putting a value back into an input field. */
export function centsToInput(amountCents: number): string {
  return `${Math.trunc(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`;
}

export function formatMoney(amountCents: number, currency: string, locale = 'en-US'): string {
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(`amountCents must be an integer, got ${amountCents}`);
  }
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  const major = Math.trunc(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  const exactDecimal = `${sign}${major}.${minor}` as `${number}`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(exactDecimal);
}
