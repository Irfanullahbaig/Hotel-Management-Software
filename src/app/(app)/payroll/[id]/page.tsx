import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { pageAuth } from "@/server/auth/page";
import { employeeName } from "@/server/services/hr";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/hr/forms";
import { PayPayrollDialog, PayrollItemDialog } from "@/components/hr/payroll-forms";
import { approvePayrollAction, deletePayrollAction, recalculatePayrollAction } from "@/server/actions/payroll";

export const metadata = { title: "Payroll run" };
export const dynamic = "force-dynamic";

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("payroll.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const run = await prisma.payrollRun.findFirst({
    where: { id, propertyId: ctx.property.id },
    include: { items: { include: { employee: { include: { department: true } } }, orderBy: { employee: { employeeNo: "asc" } } } },
  });
  if (!run) notFound();
  const users = await prisma.user.findMany({ where: { id: { in: [run.createdById, run.approvedById, run.paidById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const who = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const entries = await prisma.journalEntry.findMany({ where: { id: { in: [run.accrualEntryId, run.paymentEntryId].filter((x): x is string => !!x) } }, select: { id: true, number: true, memo: true } });
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const draft = run.status === "DRAFT";
  const canEdit = draft && ctx.can("payroll.edit");
  const fields = { runId: run.id };
  const items = run.items;
  const sum = (f: (i: (typeof items)[number]) => number) => items.reduce((s, i) => s + f(i), 0);
  const otMinutes = sum((i) => i.overtimeMinutes);

  return (
    <>
      <PageHeader
        back={{ href: "/payroll", label: "Payroll" }}
        title={<span className="flex items-center gap-2">{run.number} <StatusBadge status={run.status} /></span>}
        description={`${formatDate(run.periodStart)} → ${formatDate(run.periodEnd)} · prepared by ${who(run.createdById)}${run.notes ? ` · ${run.notes}` : ""}`}
        actions={<>
          {canEdit && <ActionButton action={recalculatePayrollAction} fields={fields} label="Recalculate" variant="secondary" size="md" pendingText="Calculating…" />}
          {draft && ctx.can("payroll.delete") && <ActionButton action={deletePayrollAction} fields={fields} label="Delete draft" variant="danger-outline" size="md" confirm="Delete this draft payroll?" />}
          {draft && ctx.can("payroll.approve") && <ActionButton action={approvePayrollAction} fields={fields} label="Approve & post" size="md" confirm={`Approve ${run.number}? Attendance and leave are re-read, then salaries are posted to the ledger and the payroll is locked.`} />}
          {run.status === "APPROVED" && ctx.can("payroll.approve") && <PayPayrollDialog runId={run.id} total={money(run.totalNet)} />}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Employees" value={run.items.length} />
        <Stat label="Gross pay" value={money(run.totalGross)} />
        <Stat label="Withholding" value={money(run.totalWithholding)} />
        <Stat label="Net pay" value={money(run.totalNet)} tone="info" />
        <Stat label="Overtime" value={formatDuration(otMinutes)} hint={money(sum((i) => Number(i.overtimePay)))} />
      </div>
      {!draft && (
        <Card className="mb-4"><CardBody className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <span>Approved by <strong>{who(run.approvedById)}</strong> {formatDateTime(run.approvedAt, ctx.property.timeZone)}</span>
          {run.paidAt && <span>Paid by <strong>{who(run.paidById)}</strong> {formatDateTime(run.paidAt, ctx.property.timeZone)} ({run.paymentMethod?.toLowerCase().replace("_", " ")})</span>}
          {entries.map((e) => <span key={e.id} className="text-ink-3">Ledger {e.number}: {e.memo}</span>)}
          {ctx.can("finance.view") && <Link className="text-brand hover:underline" href="/finance">Open ledger</Link>}
        </CardBody></Card>
      )}
      {draft && <p className="mb-3 text-xs text-ink-3">Draft. Figures update when you recalculate, and again automatically at approval. Use “Adjust” to add allowances or tax withholding.</p>}
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Employee</TH><TH className="text-right">Salary</TH><TH className="text-right">Days</TH><TH className="text-right">Base pay</TH>
              <TH className="text-right">Unpaid / absent</TH><TH className="text-right">Overtime</TH><TH className="text-right">Allowances</TH>
              <TH className="text-right">Gross</TH><TH className="text-right">Withholding</TH><TH className="text-right">Net</TH><TH />
            </tr>
          </THead>
          <TBody>
            {run.items.map((i) => (
              <TR key={i.id}>
                <TD><Link href={`/hr/employees/${i.employeeId}`} className="font-medium hover:underline">{employeeName(i.employee)}</Link><div className="text-[11px] text-ink-3">{i.employee.employeeNo} · {i.employee.department?.name ?? i.employee.jobTitle}</div>{i.note && <div className="text-[11px] text-ink-2">{i.note}</div>}</TD>
                <TD className="text-right tabular-nums">{money(i.monthlySalary)}</TD>
                <TD className="text-right tabular-nums">{i.employedDays}/{i.periodDays}</TD>
                <TD className="text-right tabular-nums">{money(i.basePay)}</TD>
                <TD className="text-right tabular-nums">{Number(i.deductionForDays) > 0 ? <>−{money(i.deductionForDays)}<div className="text-[11px] text-ink-3">{[i.unpaidLeaveDays && `${i.unpaidLeaveDays} unpaid`, i.absentDays && `${i.absentDays} absent`].filter(Boolean).join(", ")}</div></> : "—"}</TD>
                <TD className="text-right tabular-nums">{i.overtimeMinutes ? <>{money(i.overtimePay)}<div className="text-[11px] text-ink-3">{formatDuration(i.overtimeMinutes)}</div></> : "—"}</TD>
                <TD className="text-right tabular-nums">{Number(i.allowances) ? money(i.allowances) : "—"}</TD>
                <TD className="text-right tabular-nums">{money(i.gross)}</TD>
                <TD className="text-right tabular-nums">{Number(i.withholding) ? `−${money(i.withholding)}` : "—"}</TD>
                <TD className="text-right font-semibold tabular-nums">{money(i.net)}</TD>
                <TD className="text-right whitespace-nowrap">
                  {canEdit && <PayrollItemDialog item={{ id: i.id, allowances: i.allowances.toString(), withholding: i.withholding.toString(), note: i.note, gross: i.gross.toString() }} name={employeeName(i.employee)} currency={ctx.property.currency} />}
                  <LinkButton href={`/payroll/${run.id}/payslip/${i.id}`} variant="ghost" size="sm">Payslip</LinkButton>
                </TD>
              </TR>
            ))}
          </TBody>
          <tfoot className="border-t-2 border-border font-semibold">
            <tr>
              <TD>Total</TD><TD /><TD /><TD className="text-right tabular-nums">{money(sum((i) => Number(i.basePay)))}</TD>
              <TD className="text-right tabular-nums">−{money(sum((i) => Number(i.deductionForDays)))}</TD>
              <TD className="text-right tabular-nums">{money(sum((i) => Number(i.overtimePay)))}</TD>
              <TD className="text-right tabular-nums">{money(sum((i) => Number(i.allowances)))}</TD>
              <TD className="text-right tabular-nums">{money(run.totalGross)}</TD>
              <TD className="text-right tabular-nums">−{money(run.totalWithholding)}</TD>
              <TD className="text-right tabular-nums">{money(run.totalNet)}</TD><TD />
            </tr>
          </tfoot>
        </Table>
      </Card>
    </>
  );
}
