// The one place that turns integer cents into a display string.
// It builds an exact decimal string ("1234.05") instead of dividing by 100,
// so no floating-point value is ever created for money.

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
