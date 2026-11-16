import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { OVERTIME_MULTIPLIER, STANDARD_MONTHLY_HOURS } from "@/server/services/payroll";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CreatePayrollDialog } from "@/components/hr/payroll-forms";

export const metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const ctx = await pageAuth("payroll.view");
  if (!ctx) return <Forbidden />;
  const pid = ctx.property.id;
  const year = ctx.today.getUTCFullYear();
  const [runs, ytd, liability] = await Promise.all([
    prisma.payrollRun.findMany({ where: { propertyId: pid }, orderBy: { periodStart: "desc" }, include: { _count: { select: { items: true } } }, take: 36 }),
    prisma.payrollRun.aggregate({ where: { propertyId: pid, status: { in: ["APPROVED", "PAID"] }, periodStart: { gte: new Date(Date.UTC(year, 0, 1)) } }, _sum: { totalGross: true, totalNet: true, totalWithholding: true } }),
    prisma.payrollRun.aggregate({ where: { propertyId: pid, status: "APPROVED" }, _sum: { totalNet: true } }),
  ]);
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const m = ctx.today.getUTCMonth(); // default to last month: payroll is usually prepared after the month ends
  const defaultMonth = m === 0 ? `${year - 1}-12` : `${year}-${String(m).padStart(2, "0")}`;
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly payroll from HR records. Approving posts salaries to the ledger; paying settles the liability."
        actions={<>
          <LinkButton href="/hr" variant="secondary">Staff & HR</LinkButton>
          {ctx.can("payroll.create") && <CreatePayrollDialog defaultMonth={defaultMonth} />}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Gross pay ${year}`} value={money(ytd._sum.totalGross)} />
        <Stat label={`Net pay ${year}`} value={money(ytd._sum.totalNet)} />
        <Stat label={`Withholding ${year}`} value={money(ytd._sum.totalWithholding)} />
        <Stat label="Approved, not yet paid" value={money(liability._sum.totalNet)} tone={Number(liability._sum.totalNet ?? 0) > 0 ? "warn" : undefined} />
      </div>
      <Card>
        {runs.length === 0 ? (
          <EmptyState title="No payroll yet" description="Prepare a payroll for a month once employee salaries are set in Staff & HR." action={ctx.can("payroll.create") && <CreatePayrollDialog defaultMonth={defaultMonth} />} />
        ) : (
          <Table>
            <THead><tr><TH>Payroll</TH><TH>Period</TH><TH className="text-right">Staff</TH><TH className="text-right">Gross</TH><TH className="text-right">Withholding</TH><TH className="text-right">Net</TH><TH>Status</TH></tr></THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/payroll/${r.id}`} className="font-medium text-brand hover:underline">{r.number}</Link></TD>
                  <TD className="whitespace-nowrap">{formatDate(r.periodStart)} → {formatDate(r.periodEnd)}</TD>
                  <TD className="text-right tabular-nums">{r._count.items}</TD>
                  <TD className="text-right tabular-nums">{money(r.totalGross)}</TD>
                  <TD className="text-right tabular-nums">{money(r.totalWithholding)}</TD>
                  <TD className="text-right font-medium tabular-nums">{money(r.totalNet)}</TD>
                  <TD><StatusBadge status={r.status} />{r.paidAt && <div className="text-[11px] text-ink-3">{formatDateTime(r.paidAt, ctx.property.timeZone)}</div>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card className="mt-4"><CardBody className="text-xs leading-relaxed text-ink-3">
        <strong className="text-ink-2">How pay is calculated.</strong> Base pay is the monthly salary prorated by days employed in the month. Approved unpaid leave and days marked absent are deducted at the daily rate.
        Overtime is paid at {OVERTIME_MULTIPLIER}× the hourly rate (monthly salary ÷ {STANDARD_MONTHLY_HOURS} hours) for time worked beyond each shift. Allowances and tax/statutory withholding are entered per employee before approval.
        Approval re-reads attendance and leave, then posts <em>Dr Salaries &amp; Wages, Cr Salaries Payable, Cr Taxes Payable</em>; payment posts <em>Dr Salaries Payable, Cr Bank/Cash</em>.
      </CardBody></Card>
    </>
  );
}
