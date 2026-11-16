import { prisma } from "@/lib/db";
import { clockInputValue, formatClock, formatDuration, shiftSpan } from "@/lib/time";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { HrNav } from "@/components/hr/hr-nav";
import { DepartmentDialog, LeaveTypeDialog, ShiftDialog } from "@/components/hr/forms";

export const metadata = { title: "HR setup" };
export const dynamic = "force-dynamic";

export default async function HrSetupPage() {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const pid = ctx.property.id;
  const current = { status: { not: "TERMINATED" as const } };
  const [departments, shifts, leaveTypes, pendingLeave] = await Promise.all([
    prisma.department.findMany({ where: { propertyId: pid }, orderBy: { name: "asc" }, include: { _count: { select: { employees: { where: current } } } } }),
    prisma.shift.findMany({ where: { propertyId: pid }, orderBy: { startMinute: "asc" }, include: { _count: { select: { defaultFor: { where: current } } } } }),
    prisma.leaveType.findMany({ where: { propertyId: pid }, orderBy: { name: "asc" } }),
    prisma.leaveRequest.count({ where: { status: "PENDING", employee: { propertyId: pid } } }),
  ]);
  const canEdit = ctx.can("hr.edit");
  const inactive = <Badge>Inactive</Badge>;
  return (
    <>
      <PageHeader title="HR setup" description="Departments, working shifts and leave entitlements used across attendance, leave and payroll." />
      <HrNav active="setup" pendingLeave={pendingLeave} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Departments" actions={canEdit && <DepartmentDialog />} />
          <Table>
            <THead><tr><TH>Code</TH><TH>Name</TH><TH className="text-right">Staff</TH><TH /></tr></THead>
            <TBody>
              {departments.map((d) => (
                <TR key={d.id}>
                  <TD className="font-mono text-xs">{d.code}</TD>
                  <TD>{d.name} {!d.isActive && inactive}</TD>
                  <TD className="text-right tabular-nums">{d._count.employees}</TD>
                  <TD className="text-right">{canEdit && <DepartmentDialog dep={d} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Shifts" description="Late after 10 minutes; overtime is time worked beyond the shift" actions={canEdit && <ShiftDialog />} />
          <Table>
            <THead><tr><TH>Shift</TH><TH>Hours</TH><TH>Break</TH><TH className="text-right">Usual for</TH><TH /></tr></THead>
            <TBody>
              {shifts.map((s) => (
                <TR key={s.id}>
                  <TD>{s.name} <span className="font-mono text-[11px] text-ink-3">{s.code}</span> {!s.isActive && inactive}</TD>
                  <TD className="whitespace-nowrap tabular-nums">{formatClock(s.startMinute)}–{formatClock(s.endMinute)}<div className="text-[11px] text-ink-3">{formatDuration(shiftSpan(s.startMinute, s.endMinute) - s.breakMinutes)} paid{s.endMinute < s.startMinute ? " · overnight" : ""}</div></TD>
                  <TD className="tabular-nums">{s.breakMinutes} min</TD>
                  <TD className="text-right tabular-nums">{s._count.defaultFor}</TD>
                  <TD className="text-right">{canEdit && <ShiftDialog shift={{ ...s, start: clockInputValue(s.startMinute), end: clockInputValue(s.endMinute) }} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Leave types" description="Entitlement per calendar year" actions={canEdit && <LeaveTypeDialog />} />
          <Table>
            <THead><tr><TH>Type</TH><TH className="text-right">Days / year</TH><TH>Pay</TH><TH /></tr></THead>
            <TBody>
              {leaveTypes.map((t) => (
                <TR key={t.id}>
                  <TD>{t.name} <span className="font-mono text-[11px] text-ink-3">{t.code}</span> {!t.isActive && inactive}</TD>
                  <TD className="text-right tabular-nums">{t.annualDays || "No limit"}</TD>
                  <TD>{t.isPaid ? <Badge tone="ok">Paid</Badge> : <Badge tone="warn">Unpaid</Badge>}</TD>
                  <TD className="text-right">{canEdit && <LeaveTypeDialog type={t} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
