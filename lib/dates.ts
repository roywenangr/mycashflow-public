export const TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Jakarta";

/** Today's calendar date in the app timezone, as YYYY-MM-DD. */
export function today(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(
    new Date(),
  );
}

/** Current month in the app timezone, as YYYY-MM. */
export function currentMonth(): string {
  return today().slice(0, 7);
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** First day (inclusive) and first day of the next month (exclusive). */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

/** The date `delta` days away, as YYYY-MM-DD. */
export function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** "Oktober 2026" */
export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** "11 Okt", or "21 Okt 2024" when the date is outside the current year. */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: date.startsWith(today().slice(0, 4)) ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
