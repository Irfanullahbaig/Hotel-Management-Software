import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = new Prisma.Decimal(0);

/** Round half-up to 2 decimals. */
export const round2 = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: Prisma.Decimal.Value[]) => values.reduce<Prisma.Decimal>((a, v) => a.plus(D(v)), ZERO);

export const pct = (base: Prisma.Decimal.Value, percent: Prisma.Decimal.Value) =>
  round2(D(base).times(D(percent)).dividedBy(100));

export function formatMoney(value: Prisma.Decimal.Value | null | undefined, currency = "USD") {
  const n = Number(D(value).toFixed(2));
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
