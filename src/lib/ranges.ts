import { addDays, parseDateOnly, toDateOnlyString } from "./dates";

export const RANGE_OPTIONS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"],
  ["last_month", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["custom", "Custom"],
] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number][0];

/** Inclusive [from, to] business-date range. */
export function resolveRange(key: string | undefined, today: Date, custom?: { from?: string; to?: string }) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const d = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  switch (key) {
    case "yesterday": return { key, from: addDays(today, -1), to: addDays(today, -1) };
    case "week": { const dow = (today.getUTCDay() + 6) % 7; return { key, from: addDays(today, -dow), to: addDays(today, 6 - dow) }; }
    case "last_month": return { key, from: d(y, m - 1, 1), to: d(y, m, 0) };
    case "quarter": { const q = Math.floor(m / 3) * 3; return { key, from: d(y, q, 1), to: d(y, q + 3, 0) }; }
    case "year": return { key, from: d(y, 0, 1), to: d(y, 11, 31) };
    case "custom": {
      try {
        const from = parseDateOnly(custom?.from ?? ""), to = parseDateOnly(custom?.to ?? "");
        if (to >= from) return { key, from, to };
      } catch { /* fall through */ }
      return { key: "month", from: d(y, m, 1), to: d(y, m + 1, 0) };
    }
    case "today": return { key, from: today, to: today };
    default: return { key: "month", from: d(y, m, 1), to: d(y, m + 1, 0) };
  }
}

export const rangeLabel = (r: { from: Date; to: Date }) => `${toDateOnlyString(r.from)} → ${toDateOnlyString(r.to)}`;
