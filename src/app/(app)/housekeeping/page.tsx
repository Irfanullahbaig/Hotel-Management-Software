import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AssignSelect, StepButton } from "@/components/housekeeping/task-actions";

export const metadata = { title: "Housekeeping" };
export const dynamic = "force-dynamic";

export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("housekeeping.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "open";
  const mineOnly = !ctx.can("housekeeping.create") && !ctx.user.isSuperAdmin; // staff see their own queue
  const base = { propertyId: ctx.property.id, ...(mineOnly ? { assigneeId: ctx.user.id } : {}) };
  const [tasks, counts, rooms, staffRoles] = await Promise.all([
    prisma.housekeepingTask.findMany({
      where: { ...base, status: tab === "done" ? { in: ["INSPECTED", "CANCELLED"] } : tab === "inspection" ? "COMPLETED" : { in: ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED"] }, ...(tab === "done" ? { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } : {}) },
      include: { room: { include: { roomType: true } }, assignee: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 200,
    }),
    prisma.housekeepingTask.groupBy({ by: ["status"], where: base, _count: true }),
    prisma.room.groupBy({ by: ["housekeepingStatus"], where: { propertyId: ctx.property.id, isActive: true }, _count: true }),
    prisma.user.findMany({ where: { status: "ACTIVE", properties: { some: { propertyId: ctx.property.id } }, roles: { some: { role: { permissions: { some: { permission: { code: "housekeeping.edit" } } } } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const r = (s: string) => rooms.find((x) => x.housekeepingStatus === s)?._count ?? 0;
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt < new Date() && ["PENDING", "ASSIGNED", "IN_PROGRESS"].includes(t.status)).length;
  const canInspect = ctx.can("rooms.change_status");
  return (
    <>
      <PageHeader title="Housekeeping" description={mineOnly ? "Your assigned rooms" : "Checkout cleans are created automatically. Assign, clean, then inspect to return a room to sale."} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Rooms to clean" value={r("DIRTY") + r("CLEANING_ASSIGNED")} tone="danger" />
        <Stat label="Cleaning in progress" value={r("CLEANING_IN_PROGRESS")} tone="warn" />
        <Stat label="Awaiting inspection" value={r("CLEAN")} />
        <Stat label="Clean & inspected" value={r("INSPECTED")} tone="ok" />
        <Stat label="Unassigned tasks" value={c("PENDING")} />
        <Stat label="Overdue tasks" value={overdue} tone={overdue ? "danger" : undefined} />
        <Stat label="Housekeeping staff" value={staffRoles.length} />
      </div>
      <Tabs active={tab} items={[
        { key: "open", label: "Open tasks", href: "/housekeeping?tab=open", count: c("PENDING") + c("ASSIGNED") + c("IN_PROGRESS") + c("COMPLETED") },
        { key: "inspection", label: "Inspection queue", href: "/housekeeping?tab=inspection", count: c("COMPLETED") },
        { key: "done", label: "Done (7 days)", href: "/housekeeping?tab=done" },
      ]} />
      <Card>
        {tasks.length === 0 ? <EmptyState title="No tasks" description="Tasks appear when guests check out or a room is marked dirty." /> : (
          <Table>
            <THead><tr><TH>Room</TH><TH>Task</TH><TH>Priority</TH><TH>Status</TH><TH>Assigned to</TH><TH>Due</TH><TH /></tr></THead>
            <TBody>
              {tasks.map((t) => (
                <TR key={t.id}>
                  <TD><Link href={`/rooms/${t.roomId}`} className="font-medium hover:underline">{t.room.number}</Link><div className="text-[11px] text-ink-3">{t.room.roomType.name}</div></TD>
                  <TD>{titleCase(t.type)}{t.notes && <div className="max-w-xs truncate text-[11px] text-ink-3">{t.notes}</div>}</TD>
                  <TD><StatusBadge status={t.priority} /></TD>
                  <TD><StatusBadge status={t.status} /></TD>
                  <TD>{ctx.can("housekeeping.create") && !["COMPLETED", "INSPECTED", "CANCELLED"].includes(t.status) ? <AssignSelect taskId={t.id} assigneeId={t.assigneeId} staff={staffRoles} /> : t.assignee?.name ?? "—"}</TD>
                  <TD className="text-xs whitespace-nowrap text-ink-2">{t.status === "INSPECTED" ? formatDateTime(t.inspectedAt, ctx.property.timeZone) : formatDateTime(t.dueAt, ctx.property.timeZone)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      {["PENDING", "ASSIGNED"].includes(t.status) && <StepButton taskId={t.id} step="start" label="Start" variant="secondary" />}
                      {["PENDING", "ASSIGNED", "IN_PROGRESS"].includes(t.status) && <StepButton taskId={t.id} step="complete" label="Mark cleaned" />}
                      {t.status === "COMPLETED" && canInspect && <><StepButton taskId={t.id} step="fail" label="Fail" variant="secondary" /><StepButton taskId={t.id} step="inspect" label="Pass inspection" /></>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
