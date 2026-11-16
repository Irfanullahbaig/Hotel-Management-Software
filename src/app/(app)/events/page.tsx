import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, formatDate, toDateOnlyString } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { formatClock } from "@/lib/time";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { EVENT_TYPES } from "@/server/services/events";
import { createEventAction, saveVenueAction } from "@/server/actions/sales";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog } from "@/components/ui/quick-form";

export const metadata = { title: "Events" };
export const dynamic = "force-dynamic";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("events.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "upcoming";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const [venues, events] = await Promise.all([
    prisma.eventVenue.findMany({ where: { propertyId: pid }, orderBy: { name: "asc" } }),
    tab === "venues" ? [] : prisma.eventBooking.findMany({
      where: { propertyId: pid, ...(tab === "upcoming" ? { status: { in: ["TENTATIVE", "CONFIRMED"] } } : { status: { in: ["COMPLETED", "CANCELLED"] } }) },
      include: { venue: true, items: true }, orderBy: tab === "upcoming" ? [{ date: "asc" }, { startMinute: "asc" }] : [{ date: "desc" }], take: 200,
    }),
  ]);
  const next30 = await prisma.eventBooking.findMany({ where: { propertyId: pid, status: { in: ["TENTATIVE", "CONFIRMED"] }, date: { gte: ctx.today, lte: addDays(ctx.today, 30) } }, include: { items: true } });
  const active = venues.filter((v) => v.isActive);
  const canCreate = ctx.can("events.create");
  const canEdit = ctx.can("events.edit");
  return (
    <>
      <PageHeader
        title="Events & banqueting"
        description="Book venues for meetings, weddings and conferences. Each event has its own folio for deposits, charges and the final invoice."
        actions={canCreate && active.length > 0 && (
          <FormDialog action={createEventAction} title="Book an event" trigger="New event" wide
            description="Venue hire is added automatically at the venue's hourly rate. Add catering and equipment after booking."
            fields={[
              { name: "title", label: "Event title", required: true, span: 4 },
              { name: "venueId", label: "Venue", type: "select", options: active.map((v) => [v.id, `${v.name} (up to ${v.capacity})`]), required: true, defaultValue: active[0].id },
              { name: "eventType", label: "Type", type: "select", options: EVENT_TYPES.map((t) => [t, titleCase(t)]), required: true, defaultValue: "MEETING" },
              { name: "date", label: "Date", type: "date", required: true, defaultValue: toDateOnlyString(addDays(ctx.today, 7)), span: 2 },
              { name: "start", label: "Start", type: "time", required: true, defaultValue: "09:00", span: 1 },
              { name: "end", label: "End", type: "time", required: true, defaultValue: "17:00", span: 1 },
              { name: "attendees", label: "Attendees", type: "number", step: "1", min: 1, required: true, defaultValue: 20 },
              { name: "confirmed", label: "Confirmed (not tentative)", type: "checkbox" },
              { name: "clientName", label: "Client name", required: true },
              { name: "company", label: "Company" },
              { name: "email", label: "Email", type: "email" },
              { name: "phone", label: "Phone" },
              { name: "notes", label: "Notes", type: "textarea" },
            ]} />
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Events next 30 days" value={next30.length} />
        <Stat label="Confirmed" value={next30.filter((e) => e.status === "CONFIRMED").length} tone="ok" />
        <Stat label="Tentative" value={next30.filter((e) => e.status === "TENTATIVE").length} tone="warn" />
        <Stat label="Booked value (30 days)" value={money(sum(next30.flatMap((e) => e.items.map((i) => i.amount))))} />
      </div>
      <Tabs active={tab} items={[{ key: "upcoming", label: "Upcoming", href: "/events?tab=upcoming" }, { key: "past", label: "Completed & cancelled", href: "/events?tab=past" }, { key: "venues", label: "Venues", href: "/events?tab=venues" }]} />
      {tab !== "venues" ? (
        <Card>
          {events.length === 0 ? <EmptyState title={active.length ? "No events" : "Add a venue first"} /> : (
            <Table>
              <THead><tr><TH>Date</TH><TH>Event</TH><TH>Venue</TH><TH>Client</TH><TH className="text-right">Guests</TH><TH className="text-right">Value</TH><TH>Status</TH></tr></THead>
              <TBody>
                {events.map((e) => (
                  <TR key={e.id}>
                    <TD className="text-sm whitespace-nowrap">{formatDate(e.date)}<div className="text-[11px] text-ink-3">{formatClock(e.startMinute)}–{formatClock(e.endMinute)}</div></TD>
                    <TD><Link href={`/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link><div className="text-[11px] text-ink-3">{e.number} · {titleCase(e.eventType)}</div></TD>
                    <TD className="text-sm">{e.venue.name}</TD>
                    <TD className="text-sm">{e.clientName}{e.company && <div className="text-[11px] text-ink-3">{e.company}</div>}</TD>
                    <TD className="text-right tabular-nums">{e.attendees}</TD>
                    <TD className="text-right tabular-nums">{money(sum(e.items.map((i) => i.amount)))}</TD>
                    <TD><StatusBadge status={e.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex justify-end border-b border-border px-4 py-3">
            {canEdit && <FormDialog action={saveVenueAction} title="New venue" trigger="Add venue" fields={[{ name: "name", label: "Name", required: true, span: 4 }, { name: "capacity", label: "Capacity", type: "number", step: "1", min: 1, required: true }, { name: "hourlyRate", label: "Hire per hour", type: "number", required: true }]} />}
          </div>
          {venues.length === 0 ? <EmptyState title="No venues" /> : (
            <Table>
              <THead><tr><TH>Venue</TH><TH className="text-right">Capacity</TH><TH className="text-right">Hire / hour</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {venues.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-medium">{v.name}</TD><TD className="text-right tabular-nums">{v.capacity}</TD><TD className="text-right tabular-nums">{money(v.hourlyRate)}</TD>
                    <TD><StatusBadge status={v.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">{canEdit && <FormDialog action={saveVenueAction} title={`Edit ${v.name}`} trigger="Edit" triggerVariant="ghost" fields={[{ name: "id", label: "", type: "hidden", defaultValue: v.id }, { name: "name", label: "Name", required: true, span: 4, defaultValue: v.name }, { name: "capacity", label: "Capacity", type: "number", step: "1", min: 1, required: true, defaultValue: v.capacity }, { name: "hourlyRate", label: "Hire per hour", type: "number", required: true, defaultValue: v.hourlyRate.toString() }, { name: "isActive", label: "Active", type: "checkbox", defaultValue: v.isActive }]} />}</TD>
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
