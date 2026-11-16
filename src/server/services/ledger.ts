import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2, sum } from "@/lib/money";
import { BusinessError, nextNumber, pad, type Actor } from "./common";

/** System account codes used by automated postings. */
export const ACC = {
  CASH: "1000",
  BANK: "1010",
  AR: "1100",
  INVENTORY: "1200",
  AP: "2000",
  GUEST_DEPOSITS: "2100",
  TAXES_PAYABLE: "2200",
  SALARIES_PAYABLE: "2300",
  ROOM_REVENUE: "4000",
  RESTAURANT_REVENUE: "4100",
  OTHER_SERVICE_REVENUE: "4600",
  SERVICE_CHARGE_REVENUE: "4650",
  DISCOUNTS: "4900",
} as const;

export const DEFAULT_CHART: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE" }[] = [
  { code: "1000", name: "Cash in Hand", type: "ASSET" },
  { code: "1010", name: "Bank Accounts", type: "ASSET" },
  { code: "1100", name: "Accounts Receivable (Guest Ledger)", type: "ASSET" },
  { code: "1200", name: "Inventory", type: "ASSET" },
  { code: "1500", name: "Fixed Assets", type: "ASSET" },
  { code: "1510", name: "Equipment", type: "ASSET" },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "2100", name: "Guest Deposits", type: "LIABILITY" },
  { code: "2200", name: "Taxes Payable", type: "LIABILITY" },
  { code: "2300", name: "Salaries Payable", type: "LIABILITY" },
  { code: "2400", name: "Loans Payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's Capital", type: "EQUITY" },
  { code: "3100", name: "Retained Earnings", type: "EQUITY" },
  { code: "3200", name: "Owner Drawings", type: "EQUITY" },
  { code: "4000", name: "Room Revenue", type: "INCOME" },
  { code: "4100", name: "Restaurant Revenue", type: "INCOME" },
  { code: "4200", name: "Laundry Revenue", type: "INCOME" },
  { code: "4300", name: "Conference Revenue", type: "INCOME" },
  { code: "4400", name: "Event Revenue", type: "INCOME" },
  { code: "4500", name: "Spa Revenue", type: "INCOME" },
  { code: "4600", name: "Other Service Revenue", type: "INCOME" },
  { code: "4650", name: "Service Charge Revenue", type: "INCOME" },
  { code: "4900", name: "Discounts Allowed", type: "INCOME" },
  { code: "5000", name: "Salaries and Wages", type: "EXPENSE" },
  { code: "5100", name: "Utilities", type: "EXPENSE" },
  { code: "5200", name: "Food and Beverage Costs", type: "EXPENSE" },
  { code: "5300", name: "Housekeeping Expenses", type: "EXPENSE" },
  { code: "5400", name: "Maintenance Expenses", type: "EXPENSE" },
  { code: "5500", name: "Marketing Expenses", type: "EXPENSE" },
  { code: "5600", name: "Internet Expenses", type: "EXPENSE" },
  { code: "5700", name: "Rent", type: "EXPENSE" },
  { code: "5800", name: "Administrative Expenses", type: "EXPENSE" },
  { code: "5900", name: "Other Expenses", type: "EXPENSE" },
];

export const cashAccountFor = (method: PaymentMethod) => (method === "CASH" ? ACC.CASH : ACC.BANK);

export type LineInput = { account: string; debit?: Prisma.Decimal.Value; credit?: Prisma.Decimal.Value; memo?: string };

export type PostInput = {
  date: Date;
  memo: string;
  sourceType: string;
  sourceId: string;
  purpose?: string;
  lines: LineInput[];
};

/**
 * Post a balanced journal entry. Idempotent on (sourceType, sourceId, purpose):
 * posting the same source twice returns the existing entry instead of duplicating it.
 */
export async function postJournal(tx: Tx, actor: Actor, input: PostInput) {
  const purpose = input.purpose ?? "main";
  const existing = await tx.journalEntry.findUnique({
    where: { propertyId_sourceType_sourceId_purpose: { propertyId: actor.propertyId, sourceType: input.sourceType, sourceId: input.sourceId, purpose } },
  });
  if (existing) return existing;

  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0) }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  if (lines.length < 2) throw new BusinessError("A journal entry needs at least two lines.");
  for (const l of lines) {
    if (l.debit.isNegative() || l.credit.isNegative()) throw new BusinessError("Journal amounts cannot be negative.");
    if (!l.debit.isZero() && !l.credit.isZero()) throw new BusinessError("A journal line cannot have both a debit and a credit.");
  }
  const dr = sum(lines.map((l) => l.debit));
  const cr = sum(lines.map((l) => l.credit));
  if (!dr.equals(cr)) throw new BusinessError(`Unbalanced journal entry: debit ${dr.toFixed(2)} ≠ credit ${cr.toFixed(2)}.`);

  const prop = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId }, select: { booksClosedThrough: true } });
  if (prop.booksClosedThrough && input.date <= prop.booksClosedThrough) {
    throw new BusinessError(`The books are closed through ${prop.booksClosedThrough.toISOString().slice(0, 10)}. Post this on a later date or reopen the period.`);
  }
  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.account.findMany({ where: { propertyId: actor.propertyId, code: { in: codes }, isActive: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  for (const c of codes) if (!byCode.has(c)) throw new BusinessError(`Account ${c} is missing from the chart of accounts.`);

  const n = await nextNumber(tx, actor.propertyId, "JE");
  return tx.journalEntry.create({
    data: {
      propertyId: actor.propertyId,
      number: `JE-${pad(n, 7)}`,
      date: input.date,
      memo: input.memo,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      purpose,
      createdById: actor.userId,
      lines: { create: lines.map((l) => ({ accountId: byCode.get(l.account)!, debit: l.debit, credit: l.credit, memo: l.memo })) },
    },
  });
}

/** Corrections never delete: they post a mirror entry linked to the original. */
export async function reverseJournal(tx: Tx, actor: Actor, entryId: string, date: Date, reason: string) {
  const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: { include: { account: true } }, reversedBy: true } });
  if (entry.reversedBy) throw new BusinessError("This entry has already been reversed.");
  const n = await nextNumber(tx, actor.propertyId, "JE");
  return tx.journalEntry.create({
    data: {
      propertyId: entry.propertyId,
      number: `JE-${pad(n, 7)}`,
      date,
      memo: `Reversal of ${entry.number}: ${reason}`,
      sourceType: "REVERSAL",
      sourceId: entry.id,
      reversesId: entry.id,
      createdById: actor.userId,
      lines: { create: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo })) },
    },
  });
}

/** Net balance per account code (debit − credit) for entries in an optional date range. */
export async function accountBalances(tx: Tx, propertyIds: string[], opts: { from?: Date; to?: Date } = {}) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: {
      entry: { propertyId: { in: propertyIds }, date: { gte: opts.from, lte: opts.to } },
    },
    _sum: { debit: true, credit: true },
  });
  const accounts = await tx.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, { type: string; name: string; net: Prisma.Decimal }>();
  for (const r of rows) {
    const a = byId.get(r.accountId)!;
    const prev = out.get(a.code)?.net ?? ZERO;
    out.set(a.code, { type: a.type, name: a.name, net: prev.plus(D(r._sum.debit).minus(D(r._sum.credit))) });
  }
  return out;
}
