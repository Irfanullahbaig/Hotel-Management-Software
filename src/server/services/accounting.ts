import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { D, ZERO, round2, sum } from "@/lib/money";
import { cashAccountFor, postJournal, reverseJournal } from "./ledger";
import { assert, audit, nextNumber, pad, type Actor } from "./common";
import { createBill } from "./purchasing";

export const EXPENSE_PAID_BY = ["CASH", "BANK_TRANSFER", "ON_ACCOUNT"] as const;

/**
 * Record an operating expense.
 *  - Paid now: Dr expense / Cr Cash or Bank.
 *  - On account: a supplier bill is raised (Dr expense / Cr 2000 Accounts Payable) and paid later from Payables.
 */
export async function recordExpense(
  tx: Tx,
  actor: Actor,
  input: { date: Date; account: string; description: string; amount: Prisma.Decimal.Value; paidBy: (typeof EXPENSE_PAID_BY)[number]; supplierId?: string | null; reference?: string | null },
) {
  const amount = round2(input.amount);
  assert(amount.greaterThan(0), "Enter an amount greater than zero.");
  const acct = await tx.account.findFirst({ where: { propertyId: actor.propertyId, code: input.account, isActive: true } });
  assert(acct && acct.type === "EXPENSE", "Choose an expense account.");
  if (input.paidBy === "ON_ACCOUNT") assert(input.supplierId, "Choose the supplier to owe.");
  const n = await nextNumber(tx, actor.propertyId, "EXP");
  const exp = await tx.expense.create({
    data: {
      propertyId: actor.propertyId, number: `EXP-${pad(n, 5)}`, date: input.date, account: input.account, description: input.description, amount,
      paidBy: input.paidBy, supplierId: input.supplierId || null, reference: input.reference || null, createdById: actor.userId,
    },
  });
  if (input.paidBy === "ON_ACCOUNT") {
    const { bill, entry } = await createBill(tx, actor, { supplierId: input.supplierId!, amount, description: input.description, billDate: input.date, debitAccount: input.account, sourceType: "EXPENSE", sourceId: exp.id, supplierRef: input.reference });
    await tx.expense.update({ where: { id: exp.id }, data: { billId: bill.id, journalEntryId: entry.id } });
  } else {
    const e = await postJournal(tx, actor, {
      date: input.date, memo: `${exp.number}: ${input.description}`, sourceType: "EXPENSE", sourceId: exp.id,
      lines: [{ account: input.account, debit: amount }, { account: cashAccountFor(input.paidBy as PaymentMethod), credit: amount }],
    });
    await tx.expense.update({ where: { id: exp.id }, data: { journalEntryId: e.id } });
  }
  await audit(tx, actor, "expense.create", "Expense", exp.id, `${exp.number} ${acct.name}: ${amount.toFixed(2)}`);
  return exp;
}

/** A manual journal entry (adjustments, opening balances, accruals). Must balance. */
export async function postManualJournal(tx: Tx, actor: Actor, input: { date: Date; memo: string; lines: { account: string; debit: number; credit: number; memo?: string }[] }) {
  const lines = input.lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  assert(lines.length >= 2, "Enter at least two lines.");
  const dr = sum(lines.map((l) => round2(l.debit)));
  const cr = sum(lines.map((l) => round2(l.credit)));
  assert(dr.equals(cr), `Debits (${dr.toFixed(2)}) must equal credits (${cr.toFixed(2)}).`);
  const n = await nextNumber(tx, actor.propertyId, "MJ");
  const e = await postJournal(tx, actor, { date: input.date, memo: input.memo, sourceType: "MANUAL", sourceId: `MJ-${pad(n, 5)}`, lines });
  await audit(tx, actor, "journal.manual", "JournalEntry", e.id, `Manual journal ${e.number}: ${input.memo} (${dr.toFixed(2)})`);
  return e;
}

export async function reverseEntry(tx: Tx, actor: Actor, entryId: string, date: Date, reason: string) {
  const entry = await tx.journalEntry.findFirst({ where: { id: entryId, propertyId: actor.propertyId } });
  assert(entry, "Entry not found.");
  assert(entry.sourceType !== "REVERSAL", "A reversal cannot itself be reversed; post a new entry instead.");
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  assert(!p.booksClosedThrough || date > p.booksClosedThrough, "The reversal date falls in a closed period.");
  const r = await reverseJournal(tx, actor, entryId, date, reason);
  await audit(tx, actor, "journal.reverse", "JournalEntry", entryId, `Reversed ${entry.number} with ${r.number}: ${reason}`);
  return r;
}

/** Lock the books: no entry can be posted on or before `through`. */
export async function closeBooks(tx: Tx, actor: Actor, through: Date, today: Date) {
  assert(through < today, "You can only close periods that have ended (before today).");
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  assert(!p.booksClosedThrough || through > p.booksClosedThrough, "The books are already closed through a later date.");
  await tx.property.update({ where: { id: p.id }, data: { booksClosedThrough: through } });
  await audit(tx, actor, "finance.close", "Property", p.id, `Closed the books through ${through.toISOString().slice(0, 10)}`);
}

export async function reopenBooks(tx: Tx, actor: Actor, through: Date | null) {
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  assert(p.booksClosedThrough, "The books are not closed.");
  assert(!through || through < p.booksClosedThrough, "Choose an earlier date to reopen to.");
  await tx.property.update({ where: { id: p.id }, data: { booksClosedThrough: through } });
  await audit(tx, actor, "finance.reopen", "Property", p.id, `Reopened the books ${through ? `back to ${through.toISOString().slice(0, 10)}` : "completely"}`);
}

export async function addAccount(tx: Tx, actor: Actor, input: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE" }) {
  assert(/^\d{4}$/.test(input.code), "Account codes are four digits.");
  const first = { ASSET: "1", LIABILITY: "2", EQUITY: "3", INCOME: "4", EXPENSE: "5" }[input.type];
  assert(input.code.startsWith(first), `${input.type.toLowerCase()} account codes start with ${first}.`);
  const a = await tx.account.create({ data: { propertyId: actor.propertyId, code: input.code, name: input.name, type: input.type } });
  await audit(tx, actor, "account.create", "Account", a.id, `Added account ${a.code} ${a.name}`);
  return a;
}

export async function setBudget(tx: Tx, actor: Actor, input: { year: number; account: string; amount: number }) {
  const acct = await tx.account.findFirst({ where: { propertyId: actor.propertyId, code: input.account } });
  assert(acct && ["INCOME", "EXPENSE"].includes(acct.type), "Budgets are set on income and expense accounts.");
  await tx.budget.upsert({
    where: { propertyId_year_account: { propertyId: actor.propertyId, year: input.year, account: input.account } },
    update: { amount: round2(input.amount) }, create: { propertyId: actor.propertyId, year: input.year, account: input.account, amount: round2(input.amount) },
  });
}

// ─── Statements (read-only) ───

type Row = { code: string; name: string; type: string; net: Prisma.Decimal };

export async function balancesByAccount(db: Tx, propertyIds: string[], range: { from?: Date; to?: Date } = {}): Promise<Row[]> {
  const rows = await db.$queryRaw<{ code: string; name: string; type: string; net: string }[]>`
    SELECT a.code, MIN(a.name) AS name, MIN(a.type::text) AS type, COALESCE(SUM(l.debit - l.credit), 0)::text AS net
    FROM "Account" a
    LEFT JOIN "JournalLine" l ON l."accountId" = a.id
      AND EXISTS (SELECT 1 FROM "JournalEntry" e WHERE e.id = l."entryId"
        AND (${range.from ?? null}::date IS NULL OR e.date >= ${range.from ?? null}::date)
        AND (${range.to ?? null}::date IS NULL OR e.date <= ${range.to ?? null}::date))
    WHERE a."propertyId" = ANY(${propertyIds})
    GROUP BY a.code ORDER BY a.code`;
  return rows.map((r) => ({ ...r, net: D(r.net) }));
}

export function profitAndLoss(rows: Row[]) {
  const income = rows.filter((r) => r.type === "INCOME").map((r) => ({ ...r, amount: r.net.negated() }));
  const expense = rows.filter((r) => r.type === "EXPENSE").map((r) => ({ ...r, amount: r.net }));
  const totalIncome = sum(income.map((r) => r.amount));
  const totalExpense = sum(expense.map((r) => r.amount));
  return { income, expense, totalIncome, totalExpense, net: totalIncome.minus(totalExpense) };
}

export function balanceSheet(rows: Row[]) {
  const assets = rows.filter((r) => r.type === "ASSET").map((r) => ({ ...r, amount: r.net }));
  const liabilities = rows.filter((r) => r.type === "LIABILITY").map((r) => ({ ...r, amount: r.net.negated() }));
  const equity = rows.filter((r) => r.type === "EQUITY").map((r) => ({ ...r, amount: r.net.negated() }));
  const earnings = profitAndLoss(rows).net;
  const totalAssets = sum(assets.map((r) => r.amount));
  const totalLiabilities = sum(liabilities.map((r) => r.amount));
  const totalEquity = sum(equity.map((r) => r.amount)).plus(earnings);
  return { assets, liabilities, equity, earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)) };
}

const BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
const bucketOf = (daysOverdue: number) => (daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4);

/** Guest ledger balances left after check-out / event completion, aged from the invoice date. */
export async function receivablesAging(db: Tx, propertyId: string, today: Date) {
  const folios = await db.folio.findMany({
    where: { propertyId, OR: [{ reservation: { status: "CHECKED_OUT" } }, { eventBooking: { status: "COMPLETED" } }], status: "OPEN" },
    include: { transactions: { select: { amount: true } }, reservation: { include: { guest: true } }, eventBooking: true, invoices: { orderBy: { issuedAt: "desc" }, take: 1 } },
  });
  const rows = folios
    .map((f) => {
      const balance = sum(f.transactions.map((t) => t.amount));
      const inv = f.invoices[0];
      const since = inv?.issuedAt ?? f.createdAt;
      const days = Math.floor((today.getTime() - Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate())) / 86400000);
      return {
        folioId: f.id, folio: f.number, invoice: inv?.number ?? null, invoiceId: inv?.id ?? null, balance, days, bucket: bucketOf(days - 0),
        name: f.reservation ? `${f.reservation.guest.firstName} ${f.reservation.guest.lastName}` : f.eventBooking?.clientName ?? "—",
        link: f.reservation ? `/reservations/${f.reservation.id}` : f.eventBooking ? `/events/${f.eventBooking.id}` : null,
      };
    })
    .filter((r) => r.balance.greaterThan(0))
    .sort((a, b) => b.days - a.days);
  const totals = BUCKETS.map((_, i) => sum(rows.filter((r) => r.bucket === i).map((r) => r.balance)));
  return { rows, totals, buckets: BUCKETS, total: sum(rows.map((r) => r.balance)) };
}

export async function payablesAging(db: Tx, propertyId: string, today: Date) {
  const bills = await db.supplierBill.findMany({ where: { propertyId, status: { not: "PAID" } }, include: { supplier: true }, orderBy: { dueDate: "asc" } });
  const rows = bills.map((b) => {
    const owed = D(b.amount).minus(b.paid);
    const overdue = Math.floor((today.getTime() - b.dueDate.getTime()) / 86400000);
    return { ...b, owed, overdue, bucket: bucketOf(overdue) };
  });
  const totals = BUCKETS.map((_, i) => sum(rows.filter((r) => r.bucket === i).map((r) => r.owed)));
  return { rows, totals, buckets: BUCKETS, total: sum(rows.map((r) => r.owed)) };
}

/** Year-to-date actual vs. the annual budget (prorated to today) for each budgeted account. */
export async function budgetVsActual(db: Tx, propertyId: string, year: number, today: Date) {
  const from = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const to = today < end ? today : end;
  const [budgets, rows] = await Promise.all([db.budget.findMany({ where: { propertyId, year } }), balancesByAccount(db, [propertyId], { from, to })]);
  const elapsed = to < from ? 0 : (to.getTime() - from.getTime()) / 86400000 + 1;
  const yearDays = (end.getTime() - from.getTime()) / 86400000 + 1;
  const accounts = rows.filter((r) => r.type === "INCOME" || r.type === "EXPENSE");
  return accounts.map((a) => {
    const b = budgets.find((x) => x.account === a.code);
    const actual = a.type === "INCOME" ? a.net.negated() : a.net;
    const annual = D(b?.amount);
    const toDate = round2(annual.times(elapsed).dividedBy(yearDays));
    return { code: a.code, name: a.name, type: a.type, annual, toDate, actual, variance: actual.minus(toDate), hasBudget: !!b };
  });
}

/** Daily revenue / occupancy / ADR / RevPAR series for reports. */
export async function dailyKpis(db: Tx, propertyId: string, from: Date, to: Date) {
  const [rooms, nights, revenue] = await Promise.all([
    db.room.count({ where: { propertyId, isActive: true } }),
    db.$queryRaw<{ d: Date; n: bigint; r: string }[]>`
      SELECT n.date AS d, COUNT(*) AS n, COALESCE(SUM(n.rate + n."extraCharge"),0)::text AS r
      FROM "ReservationNight" n JOIN "ReservationRoom" rr ON rr.id = n."reservationRoomId" JOIN "Reservation" r ON r.id = rr."reservationId"
      WHERE r."propertyId" = ${propertyId} AND rr.status IN ('RESERVED','CHECKED_IN','CHECKED_OUT') AND r.status <> 'CANCELLED' AND r.status <> 'NO_SHOW'
        AND n.date >= ${from}::date AND n.date <= ${to}::date
      GROUP BY n.date`,
    db.$queryRaw<{ d: Date; code: string; amt: string }[]>`
      SELECT e.date AS d, a.code, SUM(l.credit - l.debit)::text AS amt
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
      WHERE e."propertyId" = ${propertyId} AND a.type = 'INCOME' AND e.date >= ${from}::date AND e.date <= ${to}::date
      GROUP BY e.date, a.code`,
  ]);
  const out: { date: Date; sold: number; occupancy: number; roomRevenue: Prisma.Decimal; adr: Prisma.Decimal; revpar: Prisma.Decimal; totalRevenue: Prisma.Decimal }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = d.getTime();
    const nr = nights.find((x) => x.d.getTime() === k);
    const sold = Number(nr?.n ?? 0);
    const rev = revenue.filter((x) => x.d.getTime() === k);
    const roomRevenue = sum(rev.filter((x) => x.code === "4000").map((x) => D(x.amt)));
    const totalRevenue = sum(rev.map((x) => D(x.amt)));
    out.push({
      date: d, sold, occupancy: rooms ? (sold / rooms) * 100 : 0, roomRevenue, totalRevenue,
      adr: sold ? round2(roomRevenue.dividedBy(sold)) : ZERO, revpar: rooms ? round2(roomRevenue.dividedBy(rooms)) : ZERO,
    });
  }
  return { rooms, days: out };
}
