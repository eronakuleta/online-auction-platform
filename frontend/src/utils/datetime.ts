// Converts between the browser's <input type="datetime-local"> value ("2026-11-10T14:30", local
// time, no zone) and the ISO-8601 UTC strings the API uses.

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO string from the API to the value a datetime-local input shows, in the user's time zone. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value to an ISO string in UTC, or null if it is empty or not a date. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Now plus some hours, as a datetime-local value: a sensible default for a new auction. */
export function localInputFromNow(hours: number): string {
  return isoToLocalInput(new Date(Date.now() + hours * 3_600_000).toISOString());
}
