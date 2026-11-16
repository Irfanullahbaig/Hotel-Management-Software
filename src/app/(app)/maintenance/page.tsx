import { prisma } from "@/lib/db";
import { addDays, formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { MAINTENANCE_CATEGORIES } from "@/server/services/operations";
import {
  assignMaintenanceAction, cancelMaintenanceAction, closeLostItemAction, createMaintenanceAction, logLostItemAction,
  resolveMaintenanceAction, runSchedulesAction, saveScheduleAction, startMaintenanceAction,
} from "@/server/actions/operations";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, PostButton, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

const PRIORITIES: Opt[] = [["LOW", "Low"], ["NORMAL", "Normal"], ["HIGH", "High"], ["URGENT", "Urgent"]];
const CATS: Opt[] = MAINTENANCE_CATEGORIES.map((c) => [c, titleCase(c).replace("It Tv", "IT / TV")]);

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("maintenance.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "open";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const [requests, counts, rooms, staff, suppliers, schedules, lost, monthCost] = await Promise.all([
    tab === "open" || tab === "closed"
      ? prisma.maintenanceRequest.findMany({
          where: { propertyId: pid, status: tab === "open" ? { in: ["PENDING", "ASSIGNED", "IN_PROGRESS"] } : { in: ["COMPLETED", "CANCELLED"] } },
          include: { room: true, assignee: { select: { name: true } } },
          orderBy: tab === "open" ? [{ priority: "desc" }, { createdAt: "asc" }] : [{ resolvedAt: "desc" }],
          take: 200,
        })
      : [],
    prisma.maintenanceRequest.groupBy({ by: ["status"], where: { propertyId: pid }, _count: true }),
    prisma.room.findMany({ where: { propertyId: pid, isActive: true }, select: { id: true, number: true }, orderBy: { number: "asc" } }),
    prisma.user.findMany({ where: { status: "ACTIVE", properties: { some: { propertyId: pid } }, roles: { some: { role: { permissions: { some: { permission: { code: "maintenance.edit" } } } } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { propertyId: pid, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tab === "schedules" ? prisma.maintenanceSchedule.findMany({ where: { propertyId: pid }, orderBy: { nextDue: "asc" } }) : [],
    tab === "lost" ? prisma.lostFoundItem.findMany({ where: { propertyId: pid }, orderBy: [{ status: "asc" }, { foundAt: "desc" }], take: 200 }) : [],
    prisma.maintenanceRequest.aggregate({ where: { propertyId: pid, status: "COMPLETED", resolvedAt: { gte: new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), 1)) } }, _sum: { cost: true } }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  const reporterIds = [...new Set(requests.map((r) => r.reportedBy).filter((x): x is string => !!x))];
  const reporters = new Map((await prisma.user.findMany({ where: { id: { in: reporterIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const roomOpts: Opt[] = rooms.map((r) => [r.id, `Room ${r.number}`]);
  const roomNo = new Map(rooms.map((r) => [r.id, r.number]));
  const staffOpts: Opt[] = staff.map((u) => [u.id, u.name]);
  const canCreate = ctx.can("maintenance.create");
  const canEdit = ctx.can("maintenance.edit");
  const dueSchedules = await prisma.maintenanceSchedule.count({ where: { propertyId: pid, isActive: true, nextDue: { lte: ctx.today } } });
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Log faults, assign technicians and track repairs. Taking a room out of service blocks it from sale until the job is closed."
        actions={canCreate && (
          <FormDialog
            action={createMaintenanceAction} title="Report a maintenance issue" trigger="New request" wide
            fields={[
              { name: "title", label: "Issue", required: true, span: 4, placeholder: "e.g. AC not cooling" },
              { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: "OTHER" },
              { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true, defaultValue: "NORMAL" },
              { name: "roomId", label: "Room", type: "select", options: roomOpts, empty: "Public area / no room" },
              { name: "assigneeId", label: "Assign to", type: "select", options: staffOpts, empty: "Unassigned" },
              { name: "dueAt", label: "Due by", type: "date" },
              { name: "blockUntil", label: "Take room out of service until", type: "date", hint: "Leave blank if the room can still be sold" },
              { name: "description", label: "Details", type: "textarea" },
            ]}
          />
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Waiting" value={c("PENDING") + c("ASSIGNED")} tone="warn" />
        <Stat label="In progress" value={c("IN_PROGRESS")} tone="info" />
        <Stat label="Completed" value={c("COMPLETED")} tone="ok" />
        <Stat label="Preventive jobs due" value={dueSchedules} tone={dueSchedules ? "danger" : undefined} />
        <Stat label="Repair cost this month" value={money(monthCost._sum.cost)} />
      </div>
      <Tabs active={tab} items={[
        { key: "open", label: "Open", href: "/maintenance?tab=open", count: c("PENDING") + c("ASSIGNED") + c("IN_PROGRESS") },
        { key: "closed", label: "Closed", href: "/maintenance?tab=closed" },
        { key: "schedules", label: "Preventive schedules", href: "/maintenance?tab=schedules" },
        { key: "lost", label: "Lost & found", href: "/maintenance?tab=lost" },
      ]} />

      {(tab === "open" || tab === "closed") && (
        <Card>
          {requests.length === 0 ? <EmptyState title={tab === "open" ? "No open requests" : "Nothing closed yet"} /> : (
            <Table>
              <THead><tr><TH>Request</TH><TH>Location</TH><TH>Priority</TH><TH>Status</TH><TH>Assignee</TH><TH>{tab === "open" ? "Due" : "Closed"}</TH>{tab === "closed" && <TH className="text-right">Cost</TH>}<TH /></tr></THead>
              <TBody>
                {requests.map((r) => (
                  <TR key={r.id}>
                    <TD><div className="font-medium">{r.title}</div><div className="text-[11px] text-ink-3">{r.number ?? "—"} · {titleCase(r.category)} · {formatDateTime(r.createdAt, ctx.property.timeZone)}{r.reportedBy ? ` · by ${reporters.get(r.reportedBy) ?? r.reportedBy}` : ""}</div>{r.resolution && <div className="mt-0.5 text-xs text-ink-2">✓ {r.resolution}</div>}</TD>
                    <TD className="text-sm">{r.room ? `Room ${r.room.number}` : "Public area"}{r.blocksRoom && r.status !== "COMPLETED" && r.status !== "CANCELLED" && <div className="text-[11px] font-medium text-danger">Out of service</div>}</TD>
                    <TD><StatusBadge status={r.priority} /></TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-sm">
                      {tab === "open" && canEdit ? (
                        <FormDialog action={assignMaintenanceAction} title={`Assign ${r.number ?? r.title}`} trigger={r.assignee?.name ?? "Assign"} triggerVariant="ghost"
                          fields={[{ name: "id", label: "", type: "hidden", defaultValue: r.id }, { name: "assigneeId", label: "Technician", type: "select", options: staffOpts, empty: "Unassigned", defaultValue: r.assigneeId, span: 4 }]} />
                      ) : r.assignee?.name ?? "—"}
                    </TD>
                    <TD className={`text-xs whitespace-nowrap ${tab === "open" && r.dueAt && r.dueAt < now ? "font-medium text-danger" : ""}`}>{tab === "open" ? (r.dueAt ? formatDate(r.dueAt) : "—") : formatDateTime(r.resolvedAt, ctx.property.timeZone)}</TD>
                    {tab === "closed" && <TD className="text-right tabular-nums">{Number(r.cost) ? money(r.cost) : "—"}</TD>}
                    <TD>
                      {tab === "open" && canEdit && (
                        <div className="flex justify-end gap-1.5">
                          {r.status !== "IN_PROGRESS" && <PostButton action={startMaintenanceAction} fields={{ id: r.id }} label="Start" />}
                          <FormDialog action={resolveMaintenanceAction} title={`Complete ${r.number ?? r.title}`} trigger="Complete" triggerVariant="primary"
                            description="Any cost is posted to Repairs & Maintenance (5400). “On account” raises a supplier bill to pay later."
                            fields={[
                              { name: "id", label: "", type: "hidden", defaultValue: r.id },
                              { name: "resolution", label: "What was done", type: "textarea", required: true },
                              { name: "cost", label: "Cost", type: "number", defaultValue: 0 },
                              { name: "paidBy", label: "Paid by", type: "select", options: [["CASH", "Cash"], ["BANK_TRANSFER", "Bank"], ["ON_ACCOUNT", "On account (supplier bill)"]], empty: "No cost" },
                              { name: "supplierId", label: "Supplier", type: "select", options: suppliers.map((s) => [s.id, s.name]), span: 4, hint: "Needed for “on account”" },
                            ]} />
                          <PostButton action={cancelMaintenanceAction} fields={{ id: r.id }} label="Cancel" variant="ghost" confirm="Cancel this request? A blocked room will be released." />
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "schedules" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm text-ink-2">Recurring jobs (filter changes, boiler service, fire safety checks). Due jobs become requests when you generate them.</p>
            <div className="flex gap-2">
              {canCreate && <PostButton action={runSchedulesAction} fields={{}} label={`Generate due jobs${dueSchedules ? ` (${dueSchedules})` : ""}`} variant="secondary" />}
              {canCreate && (
                <FormDialog action={saveScheduleAction} title="New preventive schedule" trigger="New schedule"
                  fields={[
                    { name: "title", label: "Job", required: true, span: 4 },
                    { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: "HVAC" },
                    { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true, defaultValue: "NORMAL" },
                    { name: "roomId", label: "Room", type: "select", options: roomOpts, empty: "Whole property" },
                    { name: "equipment", label: "Equipment", placeholder: "e.g. Boiler #2" },
                    { name: "everyDays", label: "Repeat every (days)", type: "number", step: "1", required: true, defaultValue: 90 },
                    { name: "nextDue", label: "First due", type: "date", required: true, defaultValue: toDateOnlyString(addDays(ctx.today, 7)) },
                    { name: "isActive", label: "", type: "hidden", defaultValue: "on" },
                  ]} />
              )}
            </div>
          </div>
          {schedules.length === 0 ? <EmptyState title="No preventive schedules" /> : (
            <Table>
              <THead><tr><TH>Job</TH><TH>Where</TH><TH>Every</TH><TH>Next due</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {schedules.map((s) => (
                  <TR key={s.id}>
                    <TD><div className="font-medium">{s.title}</div><div className="text-[11px] text-ink-3">{titleCase(s.category)}{s.equipment ? ` · ${s.equipment}` : ""}</div></TD>
                    <TD className="text-sm">{s.roomId ? `Room ${roomNo.get(s.roomId)}` : "Property"}</TD>
                    <TD className="text-sm">{s.everyDays} days</TD>
                    <TD className={`text-sm ${s.nextDue <= ctx.today && s.isActive ? "font-medium text-danger" : ""}`}>{formatDate(s.nextDue)}</TD>
                    <TD><StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">
                      {canEdit && (
                        <FormDialog action={saveScheduleAction} title={`Edit ${s.title}`} trigger="Edit" triggerVariant="ghost"
                          fields={[
                            { name: "id", label: "", type: "hidden", defaultValue: s.id },
                            { name: "title", label: "Job", required: true, span: 4, defaultValue: s.title },
                            { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: s.category },
                            { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true, defaultValue: s.priority },
                            { name: "roomId", label: "Room", type: "select", options: roomOpts, empty: "Whole property", defaultValue: s.roomId },
                            { name: "equipment", label: "Equipment", defaultValue: s.equipment },
                            { name: "everyDays", label: "Repeat every (days)", type: "number", step: "1", required: true, defaultValue: s.everyDays },
                            { name: "nextDue", label: "Next due", type: "date", required: true, defaultValue: toDateOnlyString(s.nextDue) },
                            { name: "isActive", label: "Active", type: "checkbox", defaultValue: s.isActive },
                          ]} />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "lost" && (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-ink-2">Items found on the property, and who they were returned to.</p>
            {canCreate && (
              <FormDialog action={logLostItemAction} title="Log a found item" trigger="Log item"
                fields={[
                  { name: "description", label: "Item", required: true, span: 4, placeholder: "e.g. Black leather wallet" },
                  { name: "location", label: "Where found", required: true, placeholder: "Lobby, pool…" },
                  { name: "roomId", label: "Room", type: "select", options: roomOpts },
                  { name: "foundBy", label: "Found by", span: 4 },
                  { name: "notes", label: "Notes", type: "textarea" },
                ]} />
            )}
          </div>
          {lost.length === 0 ? <EmptyState title="Nothing in lost & found" /> : (
            <Table>
              <THead><tr><TH>Item</TH><TH>Found</TH><TH>Status</TH><TH>Outcome</TH><TH /></tr></THead>
              <TBody>
                {lost.map((i) => (
                  <TR key={i.id}>
                    <TD><div className="font-medium">{i.description}</div>{i.notes && <div className="text-[11px] text-ink-3">{i.notes}</div>}</TD>
                    <TD className="text-sm">{i.location}{i.roomId ? ` · Room ${roomNo.get(i.roomId)}` : ""}<div className="text-[11px] text-ink-3">{formatDateTime(i.foundAt, ctx.property.timeZone)}{i.foundBy ? ` · ${i.foundBy}` : ""}</div></TD>
                    <TD><StatusBadge status={i.status} /></TD>
                    <TD className="text-sm">{i.returnedTo ? `Returned to ${i.returnedTo}` : i.closedAt ? formatDate(i.closedAt) : "—"}</TD>
                    <TD className="text-right">
                      {i.status === "STORED" && canEdit && (
                        <FormDialog action={closeLostItemAction} title={`Close: ${i.description}`} trigger="Return / dispose" triggerVariant="ghost"
                          fields={[
                            { name: "id", label: "", type: "hidden", defaultValue: i.id },
                            { name: "status", label: "Outcome", type: "select", options: [["RETURNED", "Returned to owner"], ["DISPOSED", "Disposed / donated"]], required: true, defaultValue: "RETURNED" },
                            { name: "returnedTo", label: "Collected by" },
                            { name: "notes", label: "Notes", type: "textarea" },
                          ]} />
                      )}
                    </TD>
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
