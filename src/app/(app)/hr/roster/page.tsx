import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, formatDate, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { employeeName } from "@/server/services/hr";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { HrNav } from "@/components/hr/hr-nav";
import { RosterForm } from "@/components/hr/forms";

export const metadata = { title: "Shift roster" };
export const dynamic = "force-dynamic";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string; department?: string }> }) {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  let anchor = ctx.today;
  try { if (sp.week) anchor = parseDateOnly(sp.week); } catch { /* today */ }
  const monday = addDays(anchor, -((anchor.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const end = days[6];
  const pid = ctx.property.id;
  const [employees, shifts, departments, pendingLeave] = await Promise.all([
    prisma.employee.findMany({
      where: { propertyId: pid, status: { in: ["ACTIVE", "ON_LEAVE"] }, hireDate: { lte: end }, OR: [{ terminationDate: null }, { terminationDate: { gte: monday } }], departmentId: sp.department || undefined },
      include: {
        department: true, defaultShift: true,
        shiftAssignments: { where: { date: { gte: monday, lte: end } } },
        leaveRequests: { where: { status: "APPROVED", startDate: { lte: end }, endDate: { gte: monday } } },
      },
      orderBy: [{ department: { name: "asc" } }, { lastName: "asc" }],
    }),
    prisma.shift.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { startMinute: "asc" } }),
    prisma.department.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.leaveRequest.count({ where: { status: "PENDING", employee: { propertyId: pid } } }),
  ]);
  const canEdit = ctx.can("hr.edit");
  const shiftName = new Map(shifts.map((s) => [s.id, s.name]));
  const key = (d: Date) => d.getTime();
  const cell = (e: (typeof employees)[number], d: Date) => {
    const a = e.shiftAssignments.find((x) => key(x.date) === key(d));
    const onLeave = e.leaveRequests.some((l) => l.startDate <= d && l.endDate >= d);
    const working = d >= e.hireDate && (!e.terminationDate || d <= e.terminationDate);
    return { assigned: a?.shiftId ?? "", effective: a?.shiftId ?? e.defaultShiftId ?? null, onLeave, working };
  };
  const coverage = days.map((d) => {
    const m = new Map<string, number>();
    for (const e of employees) {
      const c = cell(e, d);
      if (c.effective && c.working && !c.onLeave) m.set(c.effective, (m.get(c.effective) ?? 0) + 1);
    }
    return m;
  });
  const weekQs = (d: Date) => `/hr/roster?week=${toDateOnlyString(d)}${sp.department ? `&department=${sp.department}` : ""}`;

  const grid = (
    <table className="w-full border-collapse text-sm">
      <thead className="border-b border-border bg-muted/50">
        <tr>
          <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-3">Employee</th>
          {days.map((d) => (
            <th key={key(d)} className={cn("px-2 py-2.5 text-left text-xs font-medium whitespace-nowrap text-ink-3", key(d) === key(ctx.today) && "text-brand")}>
              {DAY_NAMES[d.getUTCDay()]} <span className="font-normal">{formatDate(d).slice(0, 6)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {employees.map((e) => (
          <tr key={e.id} className="hover:bg-muted/40">
            <td className="px-4 py-2"><Link href={`/hr/employees/${e.id}`} className="font-medium hover:underline">{employeeName(e)}</Link><div className="text-[11px] text-ink-3">{e.department?.name ?? e.jobTitle}</div></td>
            {days.map((d) => {
              const c = cell(e, d);
              if (!c.working) return <td key={key(d)} className="px-2 py-2 text-xs text-ink-3">—</td>;
              return (
                <td key={key(d)} className={cn("px-2 py-2", c.onLeave && "bg-info-soft/60")}>
                  {canEdit ? (
                    <Select name={`a:${e.id}:${toDateOnlyString(d)}`} defaultValue={c.assigned} className={cn("h-8 min-w-36 text-xs", !c.assigned && "text-ink-3")} aria-label={`${employeeName(e)} ${toDateOnlyString(d)}`}>
                      <option value="">{e.defaultShift ? `${e.defaultShift.name} (usual)` : "Not scheduled"}</option>
                      {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  ) : (
                    <span className={cn("text-xs", !c.assigned && "text-ink-3")}>{c.effective ? shiftName.get(c.effective) : "—"}</span>
                  )}
                  {c.onLeave && <div className="mt-0.5 text-[10px] font-medium text-info">On leave</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t-2 border-border bg-muted/30 text-xs">
        {shifts.map((s) => (
          <tr key={s.id}>
            <td className="px-4 py-1.5 text-ink-2">{s.name} <span className="text-ink-3">{formatClock(s.startMinute)}–{formatClock(s.endMinute)}</span></td>
            {coverage.map((m, i) => <td key={i} className="px-2 py-1.5 tabular-nums text-ink-2">{m.get(s.id) ?? 0}</td>)}
          </tr>
        ))}
      </tfoot>
    </table>
  );

  return (
    <>
      <PageHeader title="Shift roster" description="Plan who works which shift. Days left on “Usual” use the employee's normal shift. Staff on approved leave are highlighted and not counted." />
      <HrNav active="roster" pendingLeave={pendingLeave} />
      <form className="mb-4 flex flex-wrap items-center gap-2" method="get">
        <LinkButton href={weekQs(addDays(monday, -7))} variant="secondary" size="sm">← Previous week</LinkButton>
        <span className="px-2 text-sm font-medium">Week of {formatDate(monday)}</span>
        <LinkButton href={weekQs(addDays(monday, 7))} variant="secondary" size="sm">Next week →</LinkButton>
        <input type="hidden" name="week" value={toDateOnlyString(monday)} />
        <Select name="department" defaultValue={sp.department ?? ""} className="w-48" aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
      </form>
      <Card>
        {employees.length === 0 ? <EmptyState title="No employees to schedule" /> : (
          <div className="overflow-x-auto">{canEdit ? <RosterForm>{grid}</RosterForm> : grid}</div>
        )}
      </Card>
    </>
  );
}
