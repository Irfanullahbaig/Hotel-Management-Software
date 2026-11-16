import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { employeeName } from "@/server/services/hr";
import { EmptyState, Forbidden, PageHeader, Pagination } from "@/components/ui/layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, Stat } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { HrNav } from "@/components/hr/hr-nav";

export const metadata = { title: "Staff & HR" };
export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function HrPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const pid = ctx.property.id;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const status = sp.status ?? "current";
  const where: Prisma.EmployeeWhereInput = {
    propertyId: pid,
    departmentId: sp.department || undefined,
    status: status === "current" ? { not: "TERMINATED" } : status === "all" ? undefined : (status as Prisma.EnumEmployeeStatusFilter["equals"]),
    ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }, { jobTitle: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const sensitive = ctx.can("hr.view_sensitive");
  const current = { propertyId: pid, status: { in: ["ACTIVE", "ON_LEAVE"] as ("ACTIVE" | "ON_LEAVE")[] } };
  const [employees, total, departments, headcount, attendanceToday, onLeaveToday, pendingLeave, payrollCost, newHires] = await Promise.all([
    prisma.employee.findMany({ where, include: { department: true, user: { select: { email: true } } }, orderBy: [{ status: "asc" }, { lastName: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.employee.count({ where }),
    prisma.department.findMany({ where: { propertyId: pid }, orderBy: { name: "asc" }, include: { _count: { select: { employees: { where: { status: { not: "TERMINATED" } } } } } } }),
    prisma.employee.count({ where: current }),
    prisma.attendance.groupBy({ by: ["status"], where: { propertyId: pid, date: ctx.today }, _count: true }),
    prisma.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: ctx.today }, endDate: { gte: ctx.today }, employee: { propertyId: pid } } }),
    prisma.leaveRequest.count({ where: { status: "PENDING", employee: { propertyId: pid } } }),
    sensitive ? prisma.employee.aggregate({ where: current, _sum: { baseSalary: true } }) : null,
    prisma.employee.count({ where: { propertyId: pid, hireDate: { gte: new Date(ctx.today.getTime() - 30 * 86400000) } } }),
  ]);
  const a = (s: string) => attendanceToday.find((x) => x.status === s)?._count ?? 0;
  const present = a("PRESENT") + a("LATE") + a("HALF_DAY");
  const qs = (p: Record<string, string | number>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

  return (
    <>
      <PageHeader
        title="Staff & HR"
        description="Employee records, attendance, shifts and leave. Payroll is calculated from these records."
        actions={<>
          {ctx.can("payroll.view") && <LinkButton href="/payroll" variant="secondary">Payroll</LinkButton>}
          {ctx.can("hr.create") && <LinkButton href="/hr/employees/new"><Plus className="size-4" /> New employee</LinkButton>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Headcount" value={headcount} hint={newHires ? `${newHires} joined in last 30 days` : undefined} />
        <Stat label="Present today" value={present} tone="ok" hint={a("LATE") ? `${a("LATE")} late` : undefined} />
        <Stat label="On leave today" value={onLeaveToday} tone="info" />
        <Stat label="Absent today" value={a("ABSENT")} tone={a("ABSENT") ? "danger" : undefined} />
        <Stat label="Leave requests to review" value={<Link href="/hr/leave" className="hover:underline">{pendingLeave}</Link>} tone={pendingLeave ? "warn" : undefined} />
        {payrollCost ? <Stat label="Monthly salary cost" value={formatMoney(payrollCost._sum.baseSalary, ctx.property.currency)} /> : <Stat label="Departments" value={departments.filter((d) => d.isActive).length} />}
      </div>
      <HrNav active="employees" pendingLeave={pendingLeave} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-border p-3" method="get">
          <Input name="q" defaultValue={q} placeholder="Name, employee no., job title, phone" className="w-72" aria-label="Search employees" />
          <Select name="department" defaultValue={sp.department ?? ""} className="w-48" aria-label="Department">
            <option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d._count.employees})</option>)}
          </Select>
          <Select name="status" defaultValue={status} className="w-40" aria-label="Status">
            <option value="current">Current staff</option><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="SUSPENDED">Suspended</option><option value="TERMINATED">Left</option><option value="all">Everyone</option>
          </Select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {employees.length === 0 ? (
          <EmptyState title="No employees found" description="Add your team to track attendance, leave and payroll." action={ctx.can("hr.create") && <LinkButton href="/hr/employees/new">Add employee</LinkButton>} />
        ) : (
          <Table>
            <THead><tr><TH>Employee</TH><TH>Job</TH><TH>Department</TH><TH>Type</TH><TH>Started</TH><TH>Status</TH>{sensitive && <TH className="text-right">Monthly salary</TH>}</tr></THead>
            <TBody>
              {employees.map((e) => (
                <TR key={e.id}>
                  <TD>
                    <Link href={`/hr/employees/${e.id}`} className="font-medium text-brand hover:underline">{employeeName(e)}</Link> {e.isDemo && <Badge>Demo</Badge>}
                    <div className="text-[11px] text-ink-3">{e.employeeNo}{e.user ? ` · login ${e.user.email}` : ""}</div>
                  </TD>
                  <TD>{e.jobTitle}</TD>
                  <TD className="text-ink-2">{e.department?.name ?? "—"}</TD>
                  <TD className="text-xs">{titleCase(e.employmentType)}</TD>
                  <TD className="whitespace-nowrap">{formatDate(e.hireDate)}</TD>
                  <TD><StatusBadge status={e.status} /></TD>
                  {sensitive && <TD className="text-right tabular-nums">{formatMoney(e.baseSalary, ctx.property.currency)}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => `/hr${qs({ page: p })}`} />
      </Card>
    </>
  );
}
