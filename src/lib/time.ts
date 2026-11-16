/**
 * Clock times are stored as minutes after midnight in the property's local time
 * (attendance and shifts), so they never drift with server or browser time zones.
 */
export const DAY_MINUTES = 1440;

/** "07:30" → 450. Returns null for an empty value. */
export function parseClock(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid time: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time: ${value}`);
  return h * 60 + min;
}

/** 450 → "07:30"; values past midnight show "+1d". */
export function formatClock(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const day = Math.floor(minutes / DAY_MINUTES);
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const s = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return day > 0 ? `${s} (+1d)` : s;
}

/** Value for an <input type="time">. */
export const clockInputValue = (minutes: number | null | undefined) =>
  minutes == null ? "" : formatClock(minutes % DAY_MINUTES).slice(0, 5);

export function formatDuration(minutes: number): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Current minutes after midnight in a time zone. */
export function minutesNow(timeZone = "UTC", now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Length of a shift in minutes, handling overnight shifts. */
export function shiftSpan(startMinute: number, endMinute: number): number {
  const span = endMinute - startMinute;
  return span > 0 ? span : span + DAY_MINUTES;
}
