import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, formatDate, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { clockInputValue, formatClock, formatDuration } from "@/lib/time";
import { pageAuth } from "@/server/auth/page";
import { employeeName } from "@/server/services/hr";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, Stat } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { HrNav } from "@/components/hr/hr-nav";
import { AttendanceRowForm, CloseDayButton } from "@/components/hr/forms";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; department?: string }> }) {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  let date = ctx.today;
  try { if (sp.date) date = parseDateOnly(sp.date); } catch { /* fall back to today */ }
  if (date > ctx.today) date = ctx.today;
  const pid = ctx.property.id;
  const [employees, departments, pendingLeave] = await Promise.all([
    prisma.employee.findMany({
      where: { propertyId: pid, status: { in: ["ACTIVE", "ON_LEAVE"] }, hireDate: { lte: date }, OR: [{ terminationDate: null }, { terminationDate: { gte: date } }], departmentId: sp.department || undefined },
      include: {
        department: true, defaultShift: true,
        shiftAssignments: { where: { date }, include: { shift: true } },
        attendance: { where: { date } },
        leaveRequests: { where: { status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } }, include: { leaveType: true } },
      },
      orderBy: [{ department: { name: "asc" } }, { lastName: "asc" }],
    }),
    prisma.department.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.leaveRequest.count({ where: { status: "PENDING", employee: { propertyId: pid } } }),
  ]);
  const rows = employees.map((e) => ({ e, shift: e.shiftAssignments[0]?.shift ?? e.defaultShift, att: e.attendance[0] ?? null, leave: e.leaveRequests[0] ?? null }));
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const present = count((r) => !!r.att && ["PRESENT", "LATE", "HALF_DAY"].includes(r.att.status));
  const late = count((r) => r.att?.status === "LATE");
  const absent = count((r) => r.att?.status === "ABSENT");
  const onLeave = count((r) => !!r.leave || r.att?.status === "ON_LEAVE");
  const missing = count((r) => !r.att && !r.leave);
  const openShifts = count((r) => r.att?.clockInMinute != null && r.att.clockOutMinute == null);
  const ds = toDateOnlyString(date);
  const canEdit = ctx.can("hr.edit");
  const isToday = date.getTime() === ctx.today.getTime();

  return (
    <>
      <PageHeader title="Attendance" description="Record clock-in and clock-out times. Late arrivals and overtime are calculated from each person's shift." />
      <HrNav active="attendance" pendingLeave={pendingLeave} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <form className="flex flex-wrap items-center gap-2" method="get">
          <LinkButton href={`/hr/attendance?date=${toDateOnlyString(addDays(date, -1))}`} variant="secondary" size="sm">← Previous day</LinkButton>
          <Input type="date" name="date" defaultValue={ds} max={toDateOnlyString(ctx.today)} className="w-40" aria-label="Date" />
          <Select name="department" defaultValue={sp.department ?? ""} className="w-48" aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          <Button type="submit" variant="secondary" size="sm">Show</Button>
          {!isToday && <LinkButton href={`/hr/attendance?date=${toDateOnlyString(addDays(date, 1))}`} variant="secondary" size="sm">Next day →</LinkButton>}
        </form>
        {canEdit && !isToday && missing > 0 && <CloseDayButton date={ds} />}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={`Scheduled ${isToday ? "today" : formatDate(date)}`} value={rows.length} />
        <Stat label="Present" value={present} tone="ok" />
        <Stat label="Late" value={late} tone={late ? "warn" : undefined} />
        <Stat label="On leave" value={onLeave} tone="info" />
        <Stat label="Absent" value={absent} tone={absent ? "danger" : undefined} />
        <Stat label={isToday ? "Still on shift" : "Not recorded"} value={isToday ? openShifts : missing} tone={!isToday && missing ? "warn" : undefined} />
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No employees on this date" description="Add employees in Staff & HR to start tracking attendance." /> : (
          <Table>
            <THead><tr><TH>Employee</TH><TH>Shift</TH><TH>Recorded</TH><TH>Worked</TH>{canEdit && <TH className="text-right">Clock in · Clock out · Status</TH>}</tr></THead>
            <TBody>
              {rows.map(({ e, shift, att, leave }) => (
                <TR key={e.id}>
                  <TD><Link href={`/hr/employees/${e.id}`} className="font-medium hover:underline">{employeeName(e)}</Link><div className="text-[11px] text-ink-3">{e.jobTitle}{e.department ? ` · ${e.department.name}` : ""}</div></TD>
                  <TD className="text-xs whitespace-nowrap">{shift ? <>{shift.name}<div className="text-ink-3">{formatClock(shift.startMinute)}–{formatClock(shift.endMinute)}</div></> : <span className="text-ink-3">No shift</span>}</TD>
                  <TD>
                    {att ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <StatusBadge status={att.status} />
                        {att.clockInMinute != null && <span className="text-[11px] text-ink-3 tabular-nums">{formatClock(att.clockInMinute)} → {formatClock(att.clockOutMinute)}{att.source === "SELF" ? " · self" : ""}</span>}
                        {att.lateMinutes > 0 && <span className="text-[11px] text-warn">{att.lateMinutes} min late</span>}
                      </div>
                    ) : leave ? <Badge tone="info">On leave · {leave.leaveType.name}</Badge> : <span className="text-xs text-ink-3">Not recorded</span>}
                  </TD>
                  <TD className="tabular-nums">{att?.workedMinutes ? formatDuration(att.workedMinutes) : "—"}{att && att.overtimeMinutes > 0 && <div className="text-[11px] text-info">+{formatDuration(att.overtimeMinutes)} OT</div>}</TD>
                  {canEdit && (
                    <TD>
                      <AttendanceRowForm
                        employeeId={e.id} date={ds}
                        clockIn={clockInputValue(att?.clockInMinute)} clockOut={clockInputValue(att?.clockOutMinute)}
                        status={att?.status ?? (leave ? "ON_LEAVE" : "")} note={att?.note ?? ""}
                      />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
