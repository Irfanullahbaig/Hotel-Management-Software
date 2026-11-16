import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { inHouseGuests } from "@/server/services/sales";
import { addTablesAction, openOrderAction, saveMenuCategoryAction, saveMenuItemAction, saveOutletAction, toggleMenuItemAction } from "@/server/actions/pos";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, PostButton, type Opt } from "@/components/ui/quick-form";
import { AutoRefresh } from "@/components/ui/auto-refresh";

export const metadata = { title: "Restaurant & POS" };
export const dynamic = "force-dynamic";

const KINDS: Opt[] = [["RESTAURANT", "Restaurant"], ["BAR", "Bar"], ["CAFE", "Café"], ["ROOM_SERVICE", "Room service"]];

export default async function RestaurantPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("restaurant.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "floor";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const startOfDay = new Date(ctx.today);
  const [outlets, openOrders, categories, guests, settledToday, recent] = await Promise.all([
    prisma.outlet.findMany({ where: { propertyId: pid }, include: { tables: { where: { isActive: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.posOrder.findMany({ where: { propertyId: pid, status: "OPEN" }, include: { table: true, outlet: true, items: { where: { status: { not: "VOID" } } } }, orderBy: { openedAt: "asc" } }),
    prisma.menuCategory.findMany({ where: { propertyId: pid }, include: { items: { orderBy: { name: "asc" } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.$transaction((tx) => inHouseGuests(tx, pid)),
    prisma.posOrder.findMany({ where: { propertyId: pid, status: "SETTLED", settledAt: { gte: startOfDay } }, select: { total: true, covers: true, settledTo: true } }),
    tab === "history" ? prisma.posOrder.findMany({ where: { propertyId: pid, status: { not: "OPEN" } }, include: { outlet: true, table: true }, orderBy: { settledAt: "desc" }, take: 100 }) : [],
  ]);
  const activeOutlets = outlets.filter((o) => o.isActive);
  const busy = new Map(openOrders.filter((o) => o.tableId).map((o) => [o.tableId!, o]));
  const canCreate = ctx.can("restaurant.create");
  const canEdit = ctx.can("restaurant.edit");
  const tableOpts: Opt[] = activeOutlets.flatMap((o) => o.tables.filter((t) => !busy.has(t.id)).map((t) => [t.id, `${o.name} · ${t.name} (${t.seats})`] as Opt));
  const catOpts: Opt[] = categories.map((c) => [c.id, c.name]);
  const kitchenQueue = await prisma.posOrderItem.count({ where: { status: { in: ["NEW", "PREPARING"] }, order: { propertyId: pid, status: "OPEN" } } });

  const newOrder = canCreate && activeOutlets.length > 0 && (
    <FormDialog action={openOrderAction} title="Open an order" trigger="New order" wide
      fields={[
        { name: "outletId", label: "Outlet", type: "select", options: activeOutlets.map((o) => [o.id, o.name]), required: true, defaultValue: activeOutlets[0].id },
        { name: "kind", label: "Type", type: "select", options: [["DINE_IN", "Dine in"], ["TAKEAWAY", "Takeaway"], ["ROOM_SERVICE", "Room service"]], required: true, defaultValue: "DINE_IN" },
        { name: "tableId", label: "Table (dine in)", type: "select", options: tableOpts, empty: "—" },
        { name: "covers", label: "Covers", type: "number", step: "1", min: 1, defaultValue: 2, required: true },
        { name: "reservationId", label: "In-house guest", type: "select", options: guests.map((g) => [g.reservationId, g.label]), empty: "Not a resident", hint: "Required for room service; lets you charge the bill to the room" },
        { name: "guestName", label: "Guest name", hint: "Optional, for walk-ins" },
      ]} />
  );

  return (
    <>
      {tab === "floor" && <AutoRefresh seconds={20} />}
      <PageHeader
        title="Restaurant & POS"
        description="Take orders by table, send them to the kitchen, and settle by payment or to the guest's room."
        actions={<div className="flex gap-2"><LinkButton href="/restaurant/kitchen" variant="secondary" size="sm">Kitchen display{kitchenQueue ? ` (${kitchenQueue})` : ""}</LinkButton>{newOrder}</div>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Open orders" value={openOrders.length} tone={openOrders.length ? "info" : undefined} />
        <Stat label="Tables occupied" value={`${busy.size} / ${activeOutlets.reduce((a, o) => a + o.tables.length, 0)}`} />
        <Stat label="Items in kitchen" value={kitchenQueue} tone={kitchenQueue ? "warn" : undefined} />
        <Stat label="Sales today (incl. tax)" value={money(sum(settledToday.map((s) => s.total)))} tone="ok" />
        <Stat label="Covers today" value={settledToday.reduce((a, s) => a + s.covers, 0)} />
      </div>
      <Tabs active={tab} items={[
        { key: "floor", label: "Floor & orders", href: "/restaurant?tab=floor", count: openOrders.length },
        { key: "history", label: "Closed orders", href: "/restaurant?tab=history" },
        { key: "menu", label: "Menu", href: "/restaurant?tab=menu" },
        { key: "setup", label: "Outlets & tables", href: "/restaurant?tab=setup" },
      ]} />

      {tab === "floor" && (
        <div className="space-y-4">
          {activeOutlets.length === 0 && <Card><EmptyState title="No outlets yet" description="Add a restaurant or bar under “Outlets & tables”." /></Card>}
          {activeOutlets.map((o) => {
            const others = openOrders.filter((x) => x.outletId === o.id && !x.tableId);
            return (
              <Card key={o.id}>
                <CardHeader title={o.name} description={KINDS.find((k) => k[0] === o.kind)?.[1]} />
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {o.tables.map((t) => {
                    const ord = busy.get(t.id);
                    const inner = (
                      <>
                        <div className="flex items-center justify-between"><span className="font-semibold">{t.name}</span><span className="text-[11px] text-ink-3">{t.seats} seats</span></div>
                        {ord ? <div className="mt-1 text-xs"><div className="font-medium">{money(ord.total)}</div><div className="text-ink-3">{ord.items.length} items · {ord.covers} covers</div></div> : <div className="mt-1 text-xs text-ink-3">Free</div>}
                      </>
                    );
                    return ord ? (
                      <Link key={t.id} href={`/restaurant/orders/${ord.id}`} className="rounded-lg border border-brand/40 bg-brand-soft/50 p-2.5 hover:bg-brand-soft">{inner}</Link>
                    ) : (
                      <div key={t.id} className="rounded-lg border border-border p-2.5">{inner}</div>
                    );
                  })}
                  {others.map((ord) => (
                    <Link key={ord.id} href={`/restaurant/orders/${ord.id}`} className="rounded-lg border border-violet/40 bg-violet-soft/50 p-2.5 hover:bg-violet-soft">
                      <div className="flex items-center justify-between"><span className="font-semibold">{ord.kind === "ROOM_SERVICE" ? `Room ${ord.roomNumber ?? ""}` : "Takeaway"}</span><span className="font-mono text-[10px] text-ink-3">{ord.number}</span></div>
                      <div className="mt-1 text-xs"><div className="font-medium">{money(ord.total)}</div><div className="text-ink-3">{ord.guestName ?? `${ord.items.length} items`}</div></div>
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <Card>
          {recent.length === 0 ? <EmptyState title="No closed orders yet" /> : (
            <Table>
              <THead><tr><TH>Order</TH><TH>Outlet</TH><TH>Guest / table</TH><TH>Closed</TH><TH>Settled</TH><TH className="text-right">Total</TH></tr></THead>
              <TBody>
                {recent.map((o) => (
                  <TR key={o.id}>
                    <TD><Link href={`/restaurant/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.number}</Link></TD>
                    <TD className="text-sm">{o.outlet.name}</TD>
                    <TD className="text-sm">{o.table?.name ?? (o.roomNumber ? `Room ${o.roomNumber}` : "Takeaway")}{o.guestName ? ` · ${o.guestName}` : ""}</TD>
                    <TD className="text-xs">{formatDateTime(o.settledAt, ctx.property.timeZone)}</TD>
                    <TD>{o.status === "VOID" ? <StatusBadge status="VOID" /> : <Badge tone={o.settledTo === "ROOM" ? "brand" : "ok"}>{o.settledTo === "ROOM" ? "To room" : (o.paymentMethod ?? "").toLowerCase().replace("_", " ")}</Badge>}</TD>
                    <TD className="text-right tabular-nums">{o.status === "VOID" ? <s className="text-ink-3">{money(o.total)}</s> : money(o.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "menu" && (
        <div className="space-y-4">
          {canEdit && (
            <div className="flex justify-end gap-2">
              <FormDialog action={saveMenuCategoryAction} title="New menu category" trigger="Add category" triggerVariant="secondary"
                fields={[{ name: "name", label: "Name", required: true }, { name: "sortOrder", label: "Order", type: "number", step: "1", defaultValue: categories.length + 1 }]} />
              {categories.length > 0 && (
                <FormDialog action={saveMenuItemAction} title="New menu item" trigger="Add item"
                  fields={[
                    { name: "name", label: "Name", required: true, span: 4 },
                    { name: "categoryId", label: "Category", type: "select", options: catOpts, required: true, defaultValue: categories[0].id },
                    { name: "price", label: "Price", type: "number", required: true },
                    { name: "station", label: "Prepared at", type: "select", options: [["KITCHEN", "Kitchen"], ["BAR", "Bar"]], required: true, defaultValue: "KITCHEN" },
                    { name: "description", label: "Description" },
                    { name: "isAvailable", label: "", type: "hidden", defaultValue: "on" },
                  ]} />
              )}
            </div>
          )}
          {categories.length === 0 && <Card><EmptyState title="No menu yet" description="Add a category, then items." /></Card>}
          {categories.map((c) => (
            <Card key={c.id}>
              <CardHeader title={c.name} description={`${c.items.length} items`} />
              <Table>
                <THead><tr><TH>Item</TH><TH>Station</TH><TH className="text-right">Price</TH><TH>Status</TH><TH /></tr></THead>
                <TBody>
                  {c.items.map((m) => (
                    <TR key={m.id} className={cn(!m.isAvailable && "text-ink-3")}>
                      <TD><div className="font-medium">{m.name}</div>{m.description && <div className="text-[11px] text-ink-3">{m.description}</div>}</TD>
                      <TD className="text-xs">{m.station === "BAR" ? "Bar" : "Kitchen"}</TD>
                      <TD className="text-right tabular-nums">{money(m.price)}</TD>
                      <TD>{m.isAvailable ? <Badge tone="ok">Available</Badge> : <Badge>86’d</Badge>}</TD>
                      <TD>
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <PostButton action={toggleMenuItemAction} fields={{ id: m.id }} label={m.isAvailable ? "Mark unavailable" : "Make available"} variant="ghost" />
                            <FormDialog action={saveMenuItemAction} title={`Edit ${m.name}`} trigger="Edit" triggerVariant="ghost"
                              fields={[
                                { name: "id", label: "", type: "hidden", defaultValue: m.id },
                                { name: "name", label: "Name", required: true, span: 4, defaultValue: m.name },
                                { name: "categoryId", label: "Category", type: "select", options: catOpts, required: true, defaultValue: m.categoryId },
                                { name: "price", label: "Price", type: "number", required: true, defaultValue: m.price.toString() },
                                { name: "station", label: "Prepared at", type: "select", options: [["KITCHEN", "Kitchen"], ["BAR", "Bar"]], required: true, defaultValue: m.station },
                                { name: "description", label: "Description", defaultValue: m.description },
                                { name: "isAvailable", label: "Available", type: "checkbox", defaultValue: m.isAvailable },
                              ]} />
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      {tab === "setup" && (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-ink-2">Outlets post food & beverage sales to Restaurant Revenue (4100).</p>
            {canEdit && (
              <div className="flex gap-2">
                {outlets.length > 0 && (
                  <FormDialog action={addTablesAction} title="Add tables" trigger="Add tables" triggerVariant="secondary" description="Creates tables named prefix + number, e.g. T1…T10."
                    fields={[
                      { name: "outletId", label: "Outlet", type: "select", options: outlets.map((o) => [o.id, o.name]), required: true, defaultValue: outlets[0].id, span: 4 },
                      { name: "prefix", label: "Prefix", required: true, defaultValue: "T", span: 1 },
                      { name: "from", label: "From", type: "number", step: "1", min: 1, defaultValue: 1, required: true, span: 1 },
                      { name: "to", label: "To", type: "number", step: "1", min: 1, defaultValue: 10, required: true, span: 1 },
                      { name: "seats", label: "Seats", type: "number", step: "1", min: 1, defaultValue: 4, required: true, span: 1 },
                    ]} />
                )}
                <FormDialog action={saveOutletAction} title="New outlet" trigger="Add outlet"
                  fields={[{ name: "code", label: "Code", required: true, placeholder: "MAIN" }, { name: "name", label: "Name", required: true }, { name: "kind", label: "Type", type: "select", options: KINDS, required: true, defaultValue: "RESTAURANT" }, { name: "isActive", label: "", type: "hidden", defaultValue: "on" }]} />
              </div>
            )}
          </div>
          {outlets.length === 0 ? <EmptyState title="No outlets" /> : (
            <Table>
              <THead><tr><TH>Outlet</TH><TH>Type</TH><TH>Tables</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {outlets.map((o) => (
                  <TR key={o.id}>
                    <TD><span className="font-medium">{o.name}</span> <span className="font-mono text-[11px] text-ink-3">{o.code}</span></TD>
                    <TD className="text-sm">{KINDS.find((k) => k[0] === o.kind)?.[1]}</TD>
                    <TD className="text-xs text-ink-2">{o.tables.map((t) => t.name).join(", ") || "—"}</TD>
                    <TD><StatusBadge status={o.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">
                      {canEdit && (
                        <FormDialog action={saveOutletAction} title={`Edit ${o.name}`} trigger="Edit" triggerVariant="ghost"
                          fields={[{ name: "id", label: "", type: "hidden", defaultValue: o.id }, { name: "code", label: "Code", required: true, defaultValue: o.code }, { name: "name", label: "Name", required: true, defaultValue: o.name }, { name: "kind", label: "Type", type: "select", options: KINDS, required: true, defaultValue: o.kind }, { name: "isActive", label: "Active", type: "checkbox", defaultValue: o.isActive }]} />
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
