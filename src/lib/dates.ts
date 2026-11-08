/**
 * Business dates are stored as PostgreSQL DATE columns, which Prisma maps to
 * JS Dates at 00:00 UTC. All helpers here work on that representation.
 */
const DAY = 86_400_000;

export function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

export const toDateOnlyString = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const diffNights = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);

export function eachNight(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's business date in the property's time zone, as a UTC-midnight Date. */
export function businessToday(timeZone = "UTC", now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseDateOnly(parts);
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined, timeZone = "UTC") {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}
