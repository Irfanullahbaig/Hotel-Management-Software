import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { SERVICE_CATEGORIES } from "@/server/services/operations";
import { inHouseGuests } from "@/server/services/sales";
import { createServiceOrderAction, deliverServiceOrderAction, saveServiceItemAction, serviceOrderStatusAction } from "@/server/actions/operations";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, PostButton, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Services" };
export const dynamic = "force-dynamic";

const METHODS: Opt[] = [["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["MOBILE_WALLET", "Mobile wallet"]];
const CATS: Opt[] = Object.entries(SERVICE_CATEGORIES).map(([k, v]) => [k, v.label]);

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("services.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "open";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const [items, orders, guests, todayRevenue] = await Promise.all([
    prisma.serviceItem.findMany({ where: { propertyId: pid }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    tab === "catalog" ? [] : prisma.serviceOrder.findMany({
      where: { propertyId: pid, status: tab === "open" ? { in: ["REQUESTED", "IN_PROGRESS"] } : { in: ["DELIVERED", "CANCELLED"] } },
      include: { serviceItem: true }, orderBy: { createdAt: tab === "open" ? "asc" : "desc" }, take: 200,
    }),
    prisma.$transaction((tx) => inHouseGuests(tx, pid)),
    prisma.serviceOrder.aggregate({ where: { propertyId: pid, status: "DELIVERED", deliveredAt: { gte: new Date(ctx.today) } }, _sum: { amount: true }, _count: true }),
  ]);
  const open = await prisma.serviceOrder.count({ where: { propertyId: pid, status: { in: ["REQUESTED", "IN_PROGRESS"] } } });
  const active = items.filter((i) => i.isActive);
  const canCreate = ctx.can("services.create");
  const canEdit = ctx.can("services.edit");

  return (
    <>
      <PageHeader
        title="Guest services"
        description="Laundry, spa, transport and business services. Room charges post to the guest's folio; direct sales post straight to cash or bank."
        actions={canCreate && active.length > 0 && (
          <FormDialog action={createServiceOrderAction} title="New service order" trigger="New order" wide
            fields={[
              { name: "serviceItemId", label: "Service", type: "select", options: active.map((i) => [i.id, `${i.name} — ${money(i.price)}`]), required: true, span: 3 },
              { name: "quantity", label: "Qty", type: "number", step: "1", min: 1, defaultValue: 1, required: true, span: 1 },
              { name: "chargeTo", label: "Bill to", type: "select", options: [["ROOM", "Guest room (folio)"], ["DIRECT", "Pay on delivery"]], required: true, defaultValue: guests.length ? "ROOM" : "DIRECT" },
              { name: "reservationId", label: "In-house guest", type: "select", options: guests.map((g) => [g.reservationId, g.label]), empty: "Walk-in / non-resident" },
              { name: "guestName", label: "Name (non-resident)", hint: "Only for pay-on-delivery orders" },
              { name: "scheduledFor", label: "Scheduled for", type: "datetime-local" },
              { name: "notes", label: "Notes", type: "textarea" },
            ]} />
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open orders" value={open} tone={open ? "warn" : undefined} />
        <Stat label="Delivered today" value={todayRevenue._count} />
        <Stat label="Sales today (before tax)" value={money(todayRevenue._sum.amount)} tone="ok" />
        <Stat label="Services offered" value={active.length} />
      </div>
      <Tabs active={tab} items={[
        { key: "open", label: "Open orders", href: "/services?tab=open", count: open },
        { key: "history", label: "History", href: "/services?tab=history" },
        { key: "catalog", label: "Service catalog", href: "/services?tab=catalog" },
      ]} />

      {tab !== "catalog" ? (
        <Card>
          {orders.length === 0 ? <EmptyState title={tab === "open" ? "No open orders" : "No orders yet"} /> : (
            <Table>
              <THead><tr><TH>Order</TH><TH>Guest</TH><TH>Service</TH><TH className="text-right">Amount</TH><TH>Bill to</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {orders.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">{o.number}<div className="font-sans text-[11px] text-ink-3">{formatDateTime(o.createdAt, ctx.property.timeZone)}</div></TD>
                    <TD className="text-sm">{o.guestName}{o.roomNumber && <span className="text-ink-3"> · Room {o.roomNumber}</span>}</TD>
                    <TD className="text-sm">{o.serviceItem.name}{o.quantity > 1 && ` × ${o.quantity}`}{o.scheduledFor && <div className="text-[11px] text-ink-3">For {formatDateTime(o.scheduledFor, ctx.property.timeZone)}</div>}{o.notes && <div className="text-[11px] text-ink-3">{o.notes}</div>}</TD>
                    <TD className="text-right tabular-nums">{money(o.amount)}</TD>
                    <TD className="text-xs">{o.chargeTo === "ROOM" ? "Room folio" : o.paymentMethod ? `Paid · ${o.paymentMethod.toLowerCase().replace("_", " ")}` : "Pay on delivery"}</TD>
                    <TD><StatusBadge status={o.status} /></TD>
                    <TD>
                      {tab === "open" && canEdit && (
                        <div className="flex justify-end gap-1.5">
                          {o.status === "REQUESTED" && <PostButton action={serviceOrderStatusAction} fields={{ id: o.id, status: "IN_PROGRESS" }} label="Start" />}
                          {o.chargeTo === "ROOM" ? (
                            <PostButton action={deliverServiceOrderAction} fields={{ id: o.id }} label="Deliver & charge room" variant="primary" />
                          ) : (
                            <FormDialog action={deliverServiceOrderAction} title={`Deliver ${o.number}`} trigger="Deliver & take payment"
                              description="Service charge and tax are added to the amount."
                              fields={[{ name: "id", label: "", type: "hidden", defaultValue: o.id }, { name: "method", label: "Payment method", type: "select", options: METHODS, required: true, defaultValue: "CASH", span: 4 }]} />
                          )}
                          <PostButton action={serviceOrderStatusAction} fields={{ id: o.id, status: "CANCELLED" }} label="Cancel" variant="ghost" confirm="Cancel this order?" />
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-ink-2">Prices are before service charge and tax. Each category posts to its own revenue account.</p>
            {canCreate && (
              <FormDialog action={saveServiceItemAction} title="New service" trigger="Add service"
                fields={[
                  { name: "name", label: "Name", required: true, span: 4 },
                  { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: "LAUNDRY" },
                  { name: "price", label: "Price", type: "number", required: true },
                  { name: "isActive", label: "", type: "hidden", defaultValue: "on" },
                ]} />
            )}
          </div>
          {items.length === 0 ? <EmptyState title="No services yet" /> : (
            <Table>
              <THead><tr><TH>Service</TH><TH>Category</TH><TH>Revenue account</TH><TH className="text-right">Price</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.name}</TD>
                    <TD className="text-sm">{SERVICE_CATEGORIES[i.category]?.label ?? i.category}</TD>
                    <TD className="font-mono text-xs">{i.revenueAccount}</TD>
                    <TD className="text-right tabular-nums">{money(i.price)}</TD>
                    <TD><StatusBadge status={i.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">
                      {canEdit && (
                        <FormDialog action={saveServiceItemAction} title={`Edit ${i.name}`} trigger="Edit" triggerVariant="ghost"
                          fields={[
                            { name: "id", label: "", type: "hidden", defaultValue: i.id },
                            { name: "name", label: "Name", required: true, span: 4, defaultValue: i.name },
                            { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: i.category },
                            { name: "price", label: "Price", type: "number", required: true, defaultValue: i.price.toString() },
                            { name: "isActive", label: "Offered", type: "checkbox", defaultValue: i.isActive },
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
