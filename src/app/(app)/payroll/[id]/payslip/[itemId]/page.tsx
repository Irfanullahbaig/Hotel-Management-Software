import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { requireProperty, can } from "@/server/auth/context";
import { employeeName } from "@/server/services/hr";
import { Forbidden } from "@/components/ui/layout";
import { DocumentShell } from "@/components/ui/document";
import { PrintButton } from "@/components/ui/print-button";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Payslip" };
export const dynamic = "force-dynamic";

/** Visible to payroll viewers, and to the employee themself once the payroll is approved. */
export default async function PayslipPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const ctx = await requireProperty();
  const { id, itemId } = await params;
  const item = await prisma.payrollItem.findFirst({
    where: { id: itemId, runId: id, run: { propertyId: ctx.property.id } },
    include: { run: true, employee: { include: { department: true } } },
  });
  if (!item) notFound();
  const own = item.employee.userId === ctx.user.id;
  const staff = can(ctx, "payroll.view");
  if (!staff && !(own && item.run.status !== "DRAFT")) return <Forbidden />;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const e = item.employee;
  const earnings: [string, unknown][] = [
    [`Basic salary (${item.employedDays} of ${item.periodDays} days)`, item.basePay],
    ...(Number(item.overtimePay) ? [[`Overtime (${formatDuration(item.overtimeMinutes)} at 1.5×)`, item.overtimePay] as [string, unknown]] : []),
    ...(Number(item.allowances) ? [["Allowances", item.allowances] as [string, unknown]] : []),
  ];
  const deductions: [string, unknown][] = [
    ...(Number(item.deductionForDays) ? [[`Unpaid days (${[item.unpaidLeaveDays && `${item.unpaidLeaveDays} unpaid leave`, item.absentDays && `${item.absentDays} absent`].filter(Boolean).join(", ")})`, item.deductionForDays] as [string, unknown]] : []),
    ...(Number(item.withholding) ? [["Tax & statutory withholding", item.withholding] as [string, unknown]] : []),
  ];
  const totalDeductions = Number(item.deductionForDays) + Number(item.withholding);
  const totalEarnings = Number(item.basePay) + Number(item.overtimePay) + Number(item.allowances);
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-between">
        <LinkButton href={staff ? `/payroll/${item.runId}` : "/my-time"} variant="ghost">← Back</LinkButton>
        <PrintButton />
      </div>
      <DocumentShell property={ctx.property} title="Payslip" number={`${item.run.number}`}>
        <div className="grid grid-cols-2 gap-4 py-5 text-sm">
          <div>
            <div className="text-xs text-ink-3">Employee</div>
            <div className="font-medium">{employeeName(e)}</div>
            <div className="text-ink-2">{e.employeeNo} · {e.jobTitle}{e.department ? ` · ${e.department.name}` : ""}</div>
            {e.bankAccount && <div className="text-ink-2">Paid to {[e.bankName, `••••${e.bankAccount.slice(-4)}`].filter(Boolean).join(" ")}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-3">Pay period</div>
            <div>{formatDate(item.run.periodStart)} → {formatDate(item.run.periodEnd)}</div>
            <div className="mt-1 no-print"><StatusBadge status={item.run.status} /></div>
            {item.run.paidAt && <div className="text-ink-2">Paid {formatDate(item.run.paidAt)}</div>}
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <table className="w-full text-sm">
            <thead><tr className="border-y border-border text-left text-xs text-ink-3"><th className="py-2">Earnings</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{earnings.map(([k, v]) => <tr key={k} className="border-b border-border/60"><td className="py-1.5">{k}</td><td className="text-right tabular-nums">{money(v)}</td></tr>)}</tbody>
          </table>
          <table className="w-full text-sm">
            <thead><tr className="border-y border-border text-left text-xs text-ink-3"><th className="py-2">Deductions</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {deductions.length ? deductions.map(([k, v]) => <tr key={k} className="border-b border-border/60"><td className="py-1.5">{k}</td><td className="text-right tabular-nums">{money(v)}</td></tr>) : <tr><td className="py-1.5 text-ink-3">None</td><td /></tr>}
            </tbody>
          </table>
        </div>
        <div className="ml-auto mt-5 w-72 space-y-1 text-sm">
          <div className="flex justify-between text-ink-2"><span>Total earnings</span><span className="tabular-nums">{money(totalEarnings)}</span></div>
          <div className="flex justify-between text-ink-2"><span>Total deductions</span><span className="tabular-nums">{money(totalDeductions)}</span></div>
          <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><span>Net pay</span><span className="tabular-nums">{money(item.net)}</span></div>
        </div>
        {item.note && <p className="mt-4 text-xs text-ink-2">Note: {item.note}</p>}
        <p className="mt-6 text-[11px] text-ink-3">Monthly salary {money(item.monthlySalary)} · taxable gross {money(item.gross)}. This payslip is generated from the hotel&apos;s HR and payroll records.</p>
      </DocumentShell>
    </div>
  );
}
