import Link from "next/link";
import type { LeaveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { employeeName } from "@/server/services/hr";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { HrNav } from "@/components/hr/hr-nav";
import { CancelLeaveButton, DecisionButtons, HrLeaveDialog } from "@/components/hr/forms";

export const metadata = { title: "Leave" };
export const dynamic = "force-dynamic";

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("hr.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "pending";
  const pid = ctx.property.id;
  const statusFor: Record<string, LeaveStatus[] | undefined> = { pending: ["PENDING"], upcoming: ["APPROVED"], history: ["APPROVED", "REJECTED", "CANCELLED"] };
  const base = { employee: { propertyId: pid } };
  const [requests, counts, onLeaveToday, employees, leaveTypes] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { ...base, status: { in: statusFor[tab] ?? ["PENDING"] }, ...(tab === "upcoming" ? { endDate: { gte: ctx.today } } : tab === "history" ? { OR: [{ endDate: { lt: ctx.today } }, { status: { in: ["REJECTED", "CANCELLED"] } }] } : {}) },
      include: { employee: { include: { department: true } }, leaveType: true },
      orderBy: tab === "history" ? { startDate: "desc" } : { startDate: "asc" },
      take: 200,
    }),
    prisma.leaveRequest.groupBy({ by: ["status"], where: base, _count: true }),
    prisma.leaveRequest.findMany({ where: { ...base, status: "APPROVED", startDate: { lte: ctx.today }, endDate: { gte: ctx.today } }, include: { employee: true, leaveType: true } }),
    prisma.employee.findMany({ where: { propertyId: pid, status: { not: "TERMINATED" } }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.leaveType.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const upcoming = await prisma.leaveRequest.count({ where: { ...base, status: "APPROVED", endDate: { gte: ctx.today } } });
  const canApprove = ctx.can("hr.approve");
  const daysAhead = requests.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.days, 0);

  return (
    <>
      <PageHeader
        title="Leave"
        description="Requests from staff self-service and HR. Balances are checked against each leave type's yearly entitlement; unpaid leave is deducted in payroll."
        actions={ctx.can("hr.create") && <HrLeaveDialog employees={employees.map((e) => ({ id: e.id, name: employeeName(e) }))} leaveTypes={leaveTypes} today={toDateOnlyString(ctx.today)} canApprove={canApprove} />}
      />
      <HrNav active="leave" pendingLeave={c("PENDING")} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting decision" value={c("PENDING")} tone={c("PENDING") ? "warn" : undefined} hint={tab === "pending" && daysAhead ? `${daysAhead} day(s) requested` : undefined} />
        <Stat label="On leave today" value={onLeaveToday.length} tone="info" hint={onLeaveToday.slice(0, 3).map((l) => employeeName(l.employee)).join(", ") || undefined} />
        <Stat label="Approved, upcoming or current" value={upcoming} />
        <Stat label="Rejected (all time)" value={c("REJECTED")} />
      </div>
      <Tabs active={tab} items={[
        { key: "pending", label: "Pending", href: "/hr/leave?tab=pending", count: c("PENDING") },
        { key: "upcoming", label: "Approved & upcoming", href: "/hr/leave?tab=upcoming", count: upcoming },
        { key: "history", label: "History", href: "/hr/leave?tab=history" },
      ]} />
      <Card>
        {tab === "pending" && !canApprove && <CardHeader title="Pending requests" description="You can view requests; a manager with leave approval rights decides them." />}
        {requests.length === 0 ? <EmptyState title={tab === "pending" ? "No requests waiting" : "Nothing here"} description="Staff request leave from “My time & leave”, or HR records it here." /> : (
          <Table>
            <THead><tr><TH>Employee</TH><TH>Type</TH><TH>Dates</TH><TH className="text-right">Days</TH><TH>Reason</TH><TH>Status</TH><TH /></tr></THead>
            <TBody>
              {requests.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/hr/employees/${r.employeeId}`} className="font-medium hover:underline">{employeeName(r.employee)}</Link><div className="text-[11px] text-ink-3">{r.employee.department?.name ?? r.employee.jobTitle}</div></TD>
                  <TD>{r.leaveType.name}{!r.leaveType.isPaid && <div className="text-[11px] text-ink-3">Unpaid</div>}</TD>
                  <TD className="whitespace-nowrap">{formatDate(r.startDate)} → {formatDate(r.endDate)}</TD>
                  <TD className="text-right tabular-nums">{r.days}</TD>
                  <TD className="max-w-xs text-xs text-ink-2">{r.reason ?? "—"}</TD>
                  <TD><StatusBadge status={r.status} />{r.decidedAt && <div className="text-[11px] text-ink-3">{formatDateTime(r.decidedAt, ctx.property.timeZone)}</div>}{r.decisionNote && <div className="text-[11px] text-ink-3">{r.decisionNote}</div>}</TD>
                  <TD>{canApprove && (r.status === "PENDING" ? <DecisionButtons requestId={r.id} /> : r.status === "APPROVED" && r.endDate >= ctx.today ? <div className="flex justify-end"><CancelLeaveButton requestId={r.id} /></div> : null)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
