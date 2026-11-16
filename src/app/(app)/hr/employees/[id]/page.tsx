import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { addDays, formatDate, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatClock, formatDuration } from "@/lib/time";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { employeeName, leaveBalances } from "@/server/services/hr";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CancelLeaveButton, DecisionButtons, EmployeeStatusDialog, HrLeaveDialog } from "@/components/hr/forms";

export const metadata = { title: "Employee" };
export const dynamic = "force-dynamic";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const e = await prisma.employee.findFirst({ where: { id, propertyId: ctx.property.id }, include: { department: true, defaultShift: true, user: { select: { name: true, email: true, status: true } } } });
  if (!e) notFound();
  const sensitive = ctx.can("hr.view_sensitive");
  const showPay = sensitive || ctx.can("payroll.view");
  const year = ctx.today.getUTCFullYear();
  const since = addDays(ctx.today, -30);
  const [balances, attendance, leave, payslips, leaveTypes] = await Promise.all([
    leaveBalances(prisma, ctx.property.id, e.id, year),
    prisma.attendance.findMany({ where: { employeeId: e.id, date: { gte: since } }, include: { shift: true }, orderBy: { date: "desc" } }),
    prisma.leaveRequest.findMany({ where: { employeeId: e.id }, include: { leaveType: true }, orderBy: { startDate: "desc" }, take: 20 }),
    showPay ? prisma.payrollItem.findMany({ where: { employeeId: e.id }, include: { run: true }, orderBy: { run: { periodStart: "desc" } }, take: 12 }) : [],
    prisma.leaveType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const worked = attendance.reduce((s, a) => s + a.workedMinutes, 0);
  const overtime = attendance.reduce((s, a) => s + a.overtimeMinutes, 0);
  const late = attendance.filter((a) => a.status === "LATE").length;
  const absent = attendance.filter((a) => a.status === "ABSENT").length;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const canApprove = ctx.can("hr.approve");

  return (
    <>
      <PageHeader
        back={{ href: "/hr", label: "Staff & HR" }}
        title={<span className="flex flex-wrap items-center gap-2">{employeeName(e)} <StatusBadge status={e.status} />{e.isDemo && <Badge>Demo</Badge>}</span>}
        description={`${e.employeeNo} · ${e.jobTitle}${e.department ? ` · ${e.department.name}` : ""}`}
        actions={<>
          {ctx.can("hr.create") && e.status !== "TERMINATED" && <HrLeaveDialog employees={[]} employeeId={e.id} leaveTypes={leaveTypes} today={toDateOnlyString(ctx.today)} canApprove={canApprove} />}
          {ctx.can("hr.edit") && <EmployeeStatusDialog id={e.id} status={e.status} today={toDateOnlyString(ctx.today)} />}
          {ctx.can("hr.edit") && <LinkButton href={`/hr/employees/${e.id}/edit`}>Edit</LinkButton>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Worked (30 days)" value={formatDuration(worked)} />
        <Stat label="Overtime (30 days)" value={formatDuration(overtime)} tone={overtime ? "info" : undefined} />
        <Stat label="Late arrivals" value={late} tone={late ? "warn" : undefined} />
        <Stat label="Absences" value={absent} tone={absent ? "danger" : undefined} />
        <Stat label="Service" value={`${Math.max(0, Math.floor(((e.terminationDate ?? ctx.today).getTime() - e.hireDate.getTime()) / (365.25 * 86400000) * 10) / 10)} yrs`} hint={`since ${formatDate(e.hireDate)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Profile" />
          <CardBody>
            <DescriptionList items={[
              ["Email", e.email], ["Phone", e.phone], ["Employment", titleCase(e.employmentType)], ["Usual shift", e.defaultShift ? `${e.defaultShift.name} (${formatClock(e.defaultShift.startMinute)}–${formatClock(e.defaultShift.endMinute)})` : "None"],
              ["Start date", formatDate(e.hireDate)], ["Left", e.terminationDate ? `${formatDate(e.terminationDate)}${e.terminationReason ? ` · ${e.terminationReason}` : ""}` : null],
              ["Date of birth", e.dateOfBirth ? formatDate(e.dateOfBirth) : null], ["Gender", e.gender], ["Address", e.address],
              ["Emergency contact", e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ""}` : null],
              ["System login", e.user ? `${e.user.name} (${e.user.email})${e.user.status !== "ACTIVE" ? ` · ${e.user.status.toLowerCase()}` : ""}` : "Not linked"],
              ...(sensitive ? ([["Monthly salary", money(e.baseSalary)], ["National ID", e.nationalId], ["Bank", [e.bankName, e.bankAccount].filter(Boolean).join(" · ") || null]] as [string, React.ReactNode][]) : []),
              ["Notes", e.notes],
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`Leave balance ${year}`} description="Approved + pending against yearly entitlement" />
          <Table>
            <THead><tr><TH>Type</TH><TH className="text-right">Used</TH><TH className="text-right">Pending</TH><TH className="text-right">Left</TH></tr></THead>
            <TBody>
              {balances.map((b) => (
                <TR key={b.type.id}>
                  <TD>{b.type.name}{!b.type.isPaid && <div className="text-[11px] text-ink-3">Unpaid</div>}</TD>
                  <TD className="text-right tabular-nums">{b.used}</TD>
                  <TD className="text-right tabular-nums">{b.pending || "—"}</TD>
                  <TD className="text-right tabular-nums">{b.remaining == null ? "No limit" : `${b.remaining} / ${b.entitlement}`}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Attendance, last 30 days" actions={<LinkButton href="/hr/attendance" variant="ghost" size="sm">Record</LinkButton>} />
          {attendance.length === 0 ? <EmptyState title="No attendance recorded" /> : (
            <Table>
              <THead><tr><TH>Date</TH><TH>Shift</TH><TH>In</TH><TH>Out</TH><TH>Worked</TH><TH>Status</TH></tr></THead>
              <TBody>
                {attendance.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">{formatDate(a.date)}</TD>
                    <TD className="text-xs text-ink-2">{a.shift?.name ?? "—"}</TD>
                    <TD className="tabular-nums">{formatClock(a.clockInMinute)}</TD>
                    <TD className="tabular-nums">{formatClock(a.clockOutMinute)}</TD>
                    <TD className="tabular-nums">{a.workedMinutes ? formatDuration(a.workedMinutes) : "—"}{a.overtimeMinutes > 0 && <div className="text-[11px] text-info">+{formatDuration(a.overtimeMinutes)} OT</div>}</TD>
                    <TD><StatusBadge status={a.status} />{a.lateMinutes > 0 && <div className="text-[11px] text-ink-3">{a.lateMinutes} min late</div>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Leave history" />
          {leave.length === 0 ? <EmptyState title="No leave requests" /> : (
            <Table>
              <THead><tr><TH>Dates</TH><TH>Type</TH><TH className="text-right">Days</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {leave.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap">{formatDate(l.startDate)} → {formatDate(l.endDate)}{l.reason && <div className="max-w-xs truncate text-[11px] text-ink-3">{l.reason}</div>}</TD>
                    <TD>{l.leaveType.name}</TD>
                    <TD className="text-right tabular-nums">{l.days}</TD>
                    <TD><StatusBadge status={l.status} />{l.decisionNote && <div className="text-[11px] text-ink-3">{l.decisionNote}</div>}</TD>
                    <TD>{canApprove && (l.status === "PENDING" ? <DecisionButtons requestId={l.id} /> : l.status === "APPROVED" && l.endDate >= ctx.today ? <CancelLeaveButton requestId={l.id} /> : null)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {showPay && (
        <Card className="mt-4">
          <CardHeader title="Payslips" />
          {payslips.length === 0 ? <EmptyState title="No payroll yet" /> : (
            <Table>
              <THead><tr><TH>Payroll</TH><TH>Period</TH><TH>Status</TH><TH className="text-right">Gross</TH><TH className="text-right">Net</TH><TH /></tr></THead>
              <TBody>
                {payslips.map((p) => (
                  <TR key={p.id}>
                    <TD>{ctx.can("payroll.view") ? <Link className="text-brand hover:underline" href={`/payroll/${p.runId}`}>{p.run.number}</Link> : p.run.number}</TD>
                    <TD className="whitespace-nowrap">{formatDate(p.run.periodStart)} → {formatDate(p.run.periodEnd)}</TD>
                    <TD><StatusBadge status={p.run.status} /></TD>
                    <TD className="text-right tabular-nums">{money(p.gross)}</TD>
                    <TD className="text-right tabular-nums font-medium">{money(p.net)}</TD>
                    <TD className="text-right"><LinkButton href={`/payroll/${p.runId}/payslip/${p.id}`} variant="ghost" size="sm">Payslip</LinkButton></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
