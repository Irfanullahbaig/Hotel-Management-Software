import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2, sum } from "@/lib/money";
import { ACC, cashAccountFor, postJournal } from "./ledger";
import { BusinessError, assert, audit, lockProperty, nextNumber, notify, pad, type Actor } from "./common";
import { employeeName, inclusiveDays, overlapDays } from "./hr";

/** Hours used to turn a monthly salary into an hourly rate for overtime. */
export const STANDARD_MONTHLY_HOURS = 208;
export const OVERTIME_MULTIPLIER = 1.5;

type Period = { start: Date; end: Date };

/**
 * Pay for one employee in a period, from live HR records:
 *  base pay       = monthly salary ÷ days in period × days employed (prorates joiners and leavers)
 *  day deductions = daily rate × (approved unpaid-leave days + days marked absent)
 *  overtime       = salary ÷ 208 × 1.5 × overtime hours from attendance
 *  gross          = base − day deductions + overtime + allowances
 *  net            = gross − withholding (tax / statutory, entered by payroll)
 */
export async function calculatePay(
  tx: Tx,
  employee: { id: string; baseSalary: Prisma.Decimal; hireDate: Date; terminationDate: Date | null },
  period: Period,
  manual: { allowances?: Prisma.Decimal.Value; withholding?: Prisma.Decimal.Value } = {},
) {
  const periodDays = inclusiveDays(period.start, period.end);
  const from = employee.hireDate > period.start ? employee.hireDate : period.start;
  const to = employee.terminationDate && employee.terminationDate < period.end ? employee.terminationDate : period.end;
  const employedDays = to < from ? 0 : inclusiveDays(from, to);
  const salary = D(employee.baseSalary);
  const daily = salary.dividedBy(periodDays);
  const basePay = round2(daily.times(employedDays));

  let unpaidLeaveDays = 0;
  if (employedDays > 0) {
    const leaves = await tx.leaveRequest.findMany({ where: { employeeId: employee.id, status: "APPROVED", leaveType: { isPaid: false }, startDate: { lte: to }, endDate: { gte: from } } });
    for (const l of leaves) unpaidLeaveDays += overlapDays(l.startDate, l.endDate, from, to);
  }
  const att = employedDays > 0 ? await tx.attendance.findMany({ where: { employeeId: employee.id, date: { gte: from, lte: to } }, select: { status: true, overtimeMinutes: true } }) : [];
  const absentDays = att.filter((a) => a.status === "ABSENT").length;
  const overtimeMinutes = att.reduce((s, a) => s + a.overtimeMinutes, 0);

  const deductionForDays = Prisma.Decimal.min(basePay, round2(daily.times(unpaidLeaveDays + absentDays)));
  const overtimePay = round2(salary.dividedBy(STANDARD_MONTHLY_HOURS).times(OVERTIME_MULTIPLIER).times(overtimeMinutes).dividedBy(60));
  const allowances = round2(manual.allowances ?? 0);
  const gross = round2(basePay.minus(deductionForDays).plus(overtimePay).plus(allowances));
  const withholding = round2(manual.withholding ?? 0);
  if (withholding.greaterThan(gross)) throw new BusinessError(`Withholding cannot exceed gross pay (${gross.toFixed(2)}).`);
  return {
    monthlySalary: salary, periodDays, employedDays, basePay, unpaidLeaveDays, absentDays, deductionForDays,
    overtimeMinutes, overtimePay, allowances, gross, withholding, net: round2(gross.minus(withholding)),
  };
}

const eligibleWhere = (propertyId: string, p: Period): Prisma.EmployeeWhereInput => ({
  propertyId,
  hireDate: { lte: p.end },
  OR: [{ terminationDate: null }, { terminationDate: { gte: p.start } }],
  status: { not: "SUSPENDED" },
  baseSalary: { gt: 0 },
});

async function refreshTotals(tx: Tx, runId: string) {
  const items = await tx.payrollItem.findMany({ where: { runId } });
  return tx.payrollRun.update({
    where: { id: runId },
    data: { totalGross: sum(items.map((i) => i.gross)), totalWithholding: sum(items.map((i) => i.withholding)), totalNet: sum(items.map((i) => i.net)) },
  });
}

export function monthPeriod(month: string): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new BusinessError("Choose a month.");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  assert(mo >= 1 && mo <= 12, "Choose a valid month.");
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 0)) };
}

export async function createPayrollRun(tx: Tx, actor: Actor, input: { period: Period; notes?: string | null }) {
  await lockProperty(tx, actor.propertyId, "payroll");
  const dup = await tx.payrollRun.findUnique({ where: { propertyId_periodStart_periodEnd: { propertyId: actor.propertyId, periodStart: input.period.start, periodEnd: input.period.end } } });
  if (dup) throw new BusinessError(`A payroll run (${dup.number}) already exists for this period.`);
  const employees = await tx.employee.findMany({ where: eligibleWhere(actor.propertyId, input.period), orderBy: { employeeNo: "asc" } });
  assert(employees.length > 0, "No salaried employees were employed in this period.");
  const n = await nextNumber(tx, actor.propertyId, "PAY");
  const run = await tx.payrollRun.create({
    data: { propertyId: actor.propertyId, number: `PAY-${pad(n, 5)}`, periodStart: input.period.start, periodEnd: input.period.end, notes: input.notes ?? null, createdById: actor.userId },
  });
  for (const e of employees) {
    const pay = await calculatePay(tx, e, input.period);
    await tx.payrollItem.create({ data: { runId: run.id, employeeId: e.id, ...pay } });
  }
  const totals = await refreshTotals(tx, run.id);
  await audit(tx, actor, "payroll.create", "PayrollRun", run.id, `Created payroll ${run.number} for ${employees.length} employee(s)`, { after: totals });
  return totals;
}

async function draftRun(tx: Tx, actor: Actor, runId: string) {
  const run = await tx.payrollRun.findFirst({ where: { id: runId, propertyId: actor.propertyId } });
  assert(run, "Payroll run not found.");
  assert(run.status === "DRAFT", "Only draft payroll can be changed.");
  return run;
}

/** Re-read attendance, leave and salaries; keeps allowances, withholding and notes already entered. */
export async function recalculatePayrollRun(tx: Tx, actor: Actor, runId: string) {
  const run = await draftRun(tx, actor, runId);
  const period = { start: run.periodStart, end: run.periodEnd };
  const existing = new Map((await tx.payrollItem.findMany({ where: { runId } })).map((i) => [i.employeeId, i]));
  const employees = await tx.employee.findMany({ where: eligibleWhere(actor.propertyId, period) });
  const keep = new Set<string>();
  for (const e of employees) {
    const prev = existing.get(e.id);
    const pay = await calculatePay(tx, e, period, { allowances: prev?.allowances, withholding: prev?.withholding ?? 0 }).catch(async (err) => {
      if (err instanceof BusinessError) return calculatePay(tx, e, period, { allowances: prev?.allowances, withholding: 0 }); // gross fell below withholding
      throw err;
    });
    await tx.payrollItem.upsert({ where: { runId_employeeId: { runId, employeeId: e.id } }, update: pay, create: { runId, employeeId: e.id, ...pay, note: null } });
    keep.add(e.id);
  }
  await tx.payrollItem.deleteMany({ where: { runId, employeeId: { notIn: [...keep] } } });
  const totals = await refreshTotals(tx, runId);
  await audit(tx, actor, "payroll.recalculate", "PayrollRun", runId, `Recalculated payroll ${run.number}`, { after: totals });
  return totals;
}

export async function updatePayrollItem(tx: Tx, actor: Actor, input: { itemId: string; allowances: number; withholding: number; note?: string | null }) {
  const item = await tx.payrollItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { employee: true } });
  const run = await draftRun(tx, actor, item.runId);
  const pay = await calculatePay(tx, item.employee, { start: run.periodStart, end: run.periodEnd }, { allowances: input.allowances, withholding: input.withholding });
  const updated = await tx.payrollItem.update({ where: { id: item.id }, data: { ...pay, note: input.note ?? null } });
  await refreshTotals(tx, run.id);
  await audit(tx, actor, "payroll.item_update", "PayrollItem", item.id, `Adjusted pay for ${employeeName(item.employee)} in ${run.number}`, { before: item, after: updated });
  return updated;
}

export async function deletePayrollRun(tx: Tx, actor: Actor, runId: string) {
  const run = await draftRun(tx, actor, runId);
  await tx.payrollRun.delete({ where: { id: run.id } });
  await audit(tx, actor, "payroll.delete", "PayrollRun", run.id, `Deleted draft payroll ${run.number}`);
}

/**
 * Approve: recognise the expense and the liabilities.
 *   Dr 5000 Salaries & Wages (gross) · Cr 2300 Salaries Payable (net) · Cr 2200 Taxes Payable (withholding)
 */
export async function approvePayrollRun(tx: Tx, actor: Actor, runId: string, today: Date) {
  const run = await draftRun(tx, actor, runId);
  // Pull in any attendance or leave recorded since the draft was prepared.
  const fresh = await recalculatePayrollRun(tx, actor, runId);
  assert(D(fresh.totalGross).greaterThan(0), "This payroll has nothing to pay.");
  const date = run.periodEnd < today ? run.periodEnd : today;
  const entry = await postJournal(tx, actor, {
    date, memo: `Payroll ${run.number} accrual`, sourceType: "PAYROLL", sourceId: run.id, purpose: "accrual",
    lines: [
      { account: "5000", debit: fresh.totalGross, memo: "Gross salaries" },
      { account: ACC.SALARIES_PAYABLE, credit: fresh.totalNet, memo: "Net pay due to staff" },
      { account: ACC.TAXES_PAYABLE, credit: fresh.totalWithholding, memo: "Payroll withholding" },
    ],
  });
  const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date(), accrualEntryId: entry.id } });
  await audit(tx, actor, "payroll.approve", "PayrollRun", run.id, `Approved payroll ${run.number}: gross ${D(fresh.totalGross).toFixed(2)}, net ${D(fresh.totalNet).toFixed(2)}`);
  await notify(tx, actor.propertyId, { type: "PAYROLL_APPROVED", title: `Payroll ${run.number} approved`, body: `Net pay ${D(fresh.totalNet).toFixed(2)} is ready to be paid`, link: `/payroll/${run.id}` });
  return updated;
}

/** Pay: settle the salaries liability.  Dr 2300 Salaries Payable · Cr 1000 Cash / 1010 Bank */
export async function payPayrollRun(tx: Tx, actor: Actor, input: { runId: string; method: PaymentMethod; today: Date }) {
  const run = await tx.payrollRun.findFirst({ where: { id: input.runId, propertyId: actor.propertyId }, include: { items: { include: { employee: true } } } });
  assert(run, "Payroll run not found.");
  assert(run.status === "APPROVED", run.status === "PAID" ? "This payroll has already been paid." : "Approve the payroll before paying it.");
  let entryId: string | null = null;
  if (D(run.totalNet).greaterThan(ZERO)) {
    const entry = await postJournal(tx, actor, {
      date: input.today, memo: `Payroll ${run.number} payment`, sourceType: "PAYROLL", sourceId: run.id, purpose: "payment",
      lines: [{ account: ACC.SALARIES_PAYABLE, debit: run.totalNet }, { account: cashAccountFor(input.method), credit: run.totalNet }],
    });
    entryId = entry.id;
  }
  const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: new Date(), paidById: actor.userId, paymentMethod: input.method, paymentEntryId: entryId } });
  for (const i of run.items) {
    if (i.employee.userId) await notify(tx, actor.propertyId, { userId: i.employee.userId, type: "PAYSLIP", title: `Payslip ready: ${run.number}`, link: `/payroll/${run.id}/payslip/${i.id}` });
  }
  await audit(tx, actor, "payroll.pay", "PayrollRun", run.id, `Paid payroll ${run.number} by ${input.method.toLowerCase().replace("_", " ")}`);
  return updated;
}
