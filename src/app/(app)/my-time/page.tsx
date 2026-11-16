import { prisma } from "@/lib/db";
import { addDays, formatDate, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatClock, formatDuration } from "@/lib/time";
import { requireProperty } from "@/server/auth/context";
import { businessToday } from "@/lib/dates";
import { employeeName, leaveBalances, shiftFor } from "@/server/services/hr";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CancelLeaveButton, ClockButton, MyLeaveForm } from "@/components/hr/forms";

export const metadata = { title: "My time & leave" };
export const dynamic = "force-dynamic";

export default async function MyTimePage() {
  const ctx = await requireProperty();
  const today = businessToday(ctx.property.timeZone);
  const e = await prisma.employee.findFirst({ where: { userId: ctx.user.id, propertyId: ctx.property.id }, include: { department: true } });
  if (!e) {
    return (
      <>
        <PageHeader title="My time & leave" />
        <Card><EmptyState title="Your login is not linked to an employee record" description={`Ask HR to open your employee profile at ${ctx.property.name} and choose your login under “System login”. You can then clock in and request leave here.`} /></Card>
      </>
    );
  }
  const year = today.getUTCFullYear();
  const [todayRow, yesterdayRow, shift, recent, leave, balances, leaveTypes, payslips] = await Promise.all([
    prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date: today } } }),
    prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date: addDays(today, -1) } } }),
    shiftFor(prisma, e.id, today),
    prisma.attendance.findMany({ where: { employeeId: e.id, date: { gte: addDays(today, -14) } }, orderBy: { date: "desc" } }),
    prisma.leaveRequest.findMany({ where: { employeeId: e.id }, include: { leaveType: true }, orderBy: { startDate: "desc" }, take: 10 }),
    leaveBalances(prisma, ctx.property.id, e.id, year),
    prisma.leaveType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.payrollItem.findMany({ where: { employeeId: e.id, run: { status: { in: ["APPROVED", "PAID"] } } }, include: { run: true }, orderBy: { run: { periodStart: "desc" } }, take: 6 }),
  ]);
  const upcoming = await prisma.shiftAssignment.findMany({ where: { employeeId: e.id, date: { gte: today, lte: addDays(today, 6) } }, include: { shift: true }, orderBy: { date: "asc" } });
  const openYesterday = yesterdayRow?.clockInMinute != null && yesterdayRow.clockOutMinute == null;
  const clockedIn = todayRow?.clockInMinute != null;
  const clockedOut = todayRow?.clockOutMinute != null;
  const canClockIn = !clockedIn && !openYesterday && e.status === "ACTIVE";
  const canClockOut = (clockedIn && !clockedOut) || openYesterday;
  const worked14 = recent.reduce((s, a) => s + a.workedMinutes, 0);
  const ot14 = recent.reduce((s, a) => s + a.overtimeMinutes, 0);

  return (
    <>
      <PageHeader title="My time & leave" description={`${employeeName(e)} · ${e.employeeNo} · ${e.jobTitle}${e.department ? ` · ${e.department.name}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title={`Today · ${formatDate(today)}`} description={shift ? `${shift.name} shift ${formatClock(shift.startMinute)}–${formatClock(shift.endMinute)}` : "No shift scheduled"} />
          <CardBody className="space-y-3">
            {todayRow && (
              <div className="flex items-center gap-2 text-sm">
                <StatusBadge status={todayRow.status} />
                {todayRow.clockInMinute != null && <span className="tabular-nums">In {formatClock(todayRow.clockInMinute)}{todayRow.clockOutMinute != null && ` · Out ${formatClock(todayRow.clockOutMinute)} · ${formatDuration(todayRow.workedMinutes)}`}</span>}
              </div>
            )}
            {openYesterday && <p className="text-xs text-warn">You are still clocked in from yesterday ({formatClock(yesterdayRow!.clockInMinute)}).</p>}
            <div className="flex gap-2">
              {canClockIn && <ClockButton direction="in" />}
              {canClockOut && <ClockButton direction="out" />}
              {!canClockIn && !canClockOut && <p className="text-sm text-ink-3">{clockedOut ? "Done for today." : e.status !== "ACTIVE" ? "Clocking is available while your status is active." : ""}</p>}
            </div>
            {upcoming.length > 0 && (
              <div className="border-t border-border pt-3 text-xs text-ink-2">
                <div className="mb-1 font-medium text-ink-3">Rostered this week</div>
                {upcoming.map((u) => <div key={u.id} className="flex justify-between"><span>{formatDate(u.date)}</span><span>{u.shift.name} {formatClock(u.shift.startMinute)}–{formatClock(u.shift.endMinute)}</span></div>)}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Request leave" description="HR is notified and will approve or reject it." />
          <CardBody><MyLeaveForm leaveTypes={leaveTypes} today={toDateOnlyString(today)} /></CardBody>
        </Card>
        <Card>
          <CardHeader title={`Leave balance ${year}`} />
          <Table>
            <THead><tr><TH>Type</TH><TH className="text-right">Used</TH><TH className="text-right">Pending</TH><TH className="text-right">Left</TH></tr></THead>
            <TBody>
              {balances.map((b) => (
                <TR key={b.type.id}><TD>{b.type.name}</TD><TD className="text-right tabular-nums">{b.used}</TD><TD className="text-right tabular-nums">{b.pending || "—"}</TD><TD className="text-right tabular-nums">{b.remaining ?? "No limit"}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Worked, last 14 days" value={formatDuration(worked14)} />
        <Stat label="Overtime, last 14 days" value={formatDuration(ot14)} tone={ot14 ? "info" : undefined} />
        <Stat label="Late arrivals" value={recent.filter((r) => r.status === "LATE").length} />
        <Stat label="Absences" value={recent.filter((r) => r.status === "ABSENT").length} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="My leave requests" />
          {leave.length === 0 ? <EmptyState title="No leave requested yet" /> : (
            <Table>
              <THead><tr><TH>Dates</TH><TH>Type</TH><TH className="text-right">Days</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {leave.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap">{formatDate(l.startDate)} → {formatDate(l.endDate)}</TD>
                    <TD>{l.leaveType.name}</TD>
                    <TD className="text-right tabular-nums">{l.days}</TD>
                    <TD><StatusBadge status={l.status} />{l.decisionNote && <div className="text-[11px] text-ink-3">{l.decisionNote}</div>}</TD>
                    <TD className="text-right">{l.status === "PENDING" && <CancelLeaveButton requestId={l.id} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="My payslips" />
          {payslips.length === 0 ? <EmptyState title="No payslips yet" /> : (
            <Table>
              <THead><tr><TH>Period</TH><TH>Status</TH><TH className="text-right">Net pay</TH><TH /></tr></THead>
              <TBody>
                {payslips.map((p) => (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap">{formatDate(p.run.periodStart)} → {formatDate(p.run.periodEnd)}</TD>
                    <TD><StatusBadge status={p.run.status} /></TD>
                    <TD className="text-right font-medium tabular-nums">{formatMoney(p.net, ctx.property.currency)}</TD>
                    <TD className="text-right"><LinkButton href={`/payroll/${p.runId}/payslip/${p.id}`} variant="ghost" size="sm">View</LinkButton></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
