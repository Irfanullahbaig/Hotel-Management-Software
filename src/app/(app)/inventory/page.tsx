import { prisma } from "@/lib/db";
import { formatDate, toDateOnlyString } from "@/lib/dates";
import { D, formatMoney, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { INVENTORY_CATEGORIES, stockOnHand } from "@/server/services/inventory";
import { purchaseRequestAction, saveItemAction, saveLocationAction, stockMoveAction } from "@/server/actions/inventory";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, type FieldSpec, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

const CATS: Opt[] = Object.entries(INVENTORY_CATEGORIES).map(([k, v]) => [k, v.label]);
const DEPTS: Opt[] = [["Housekeeping", "Housekeeping"], ["Kitchen", "Kitchen"], ["Bar", "Bar"], ["Front Office", "Front Office"], ["Engineering", "Engineering"], ["Administration", "Administration"]];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string }> }) {
  const ctx = await pageAuth("inventory.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const tab = sp.tab ?? "stock";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const [items, locations, txns, ledger] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { propertyId: pid, ...(sp.category ? { category: sp.category } : {}) }, include: { levels: { include: { location: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.stockLocation.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    tab === "moves" ? prisma.inventoryTxn.findMany({ where: { propertyId: pid }, include: { item: true, fromLocation: true, toLocation: true }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    prisma.$queryRaw<{ net: string }[]>`SELECT COALESCE(SUM(l.debit - l.credit),0)::text AS net FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" WHERE a."propertyId" = ${pid} AND a.code = '1200'`,
  ]);
  const active = items.filter((i) => i.isActive);
  const value = sum(active.map((i) => stockOnHand(i).times(i.avgCost)));
  const low = active.filter((i) => D(i.reorderLevel).greaterThan(0) && stockOnHand(i).lessThanOrEqualTo(i.reorderLevel));
  const itemOpts: Opt[] = active.map((i) => [i.id, `${i.name} (${i.sku}, ${i.unit})`]);
  const locOpts: Opt[] = locations.map((l) => [l.id, l.name]);
  const main = locations.find((l) => l.code === "MAIN")?.id ?? locations[0]?.id;
  const today = toDateOnlyString(ctx.today);
  const canCreate = ctx.can("inventory.create");
  const canEdit = ctx.can("inventory.edit");
  const canCount = ctx.can("inventory.approve");
  const canRequest = ctx.can("procurement.create");
  const shown = tab === "low" ? low : items;

  const itemFields = (i?: (typeof items)[number]): FieldSpec[] => [
    ...(i ? [{ name: "id", label: "", type: "hidden" as const, defaultValue: i.id }] : []),
    { name: "name", label: "Name", required: true, span: 4, defaultValue: i?.name },
    { name: "sku", label: "SKU", required: true, defaultValue: i?.sku, span: 1 },
    { name: "category", label: "Category", type: "select", options: CATS, required: true, defaultValue: i?.category ?? "HOUSEKEEPING", span: 2 },
    { name: "unit", label: "Unit", required: true, defaultValue: i?.unit ?? "pcs", span: 1 },
    { name: "reorderLevel", label: "Reorder at", type: "number", step: "0.001", defaultValue: i?.reorderLevel.toString() ?? 0, hint: "You are alerted when total stock falls to this level" },
    { name: "isActive", label: "Active", type: i ? "checkbox" : "hidden", defaultValue: i ? i.isActive : "on" },
  ];

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock by store location, valued at weighted-average cost. Issues to departments post to the department's expense account."
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreate && active.length > 0 && (
              <>
                <FormDialog action={stockMoveAction} title="Receive stock" trigger="Receive" triggerVariant="secondary" description="For purchases made without a PO, or opening stock. Purchase-order deliveries are received under Procurement."
                  fields={[
                    { name: "type", label: "", type: "hidden", defaultValue: "RECEIVE" },
                    { name: "itemId", label: "Item", type: "select", options: itemOpts, required: true, span: 4, empty: "Choose…" },
                    { name: "locationId", label: "Into", type: "select", options: locOpts, required: true, defaultValue: main },
                    { name: "date", label: "Date", type: "date", required: true, defaultValue: today },
                    { name: "quantity", label: "Quantity", type: "number", step: "0.001", required: true },
                    { name: "unitCost", label: "Unit cost", type: "number", step: "0.0001", required: true },
                    { name: "paidBy", label: "Paid by", type: "select", options: [["CASH", "Cash"], ["BANK_TRANSFER", "Bank"], ["OPENING", "Opening stock (owner's capital)"]], required: true, defaultValue: "CASH", span: 4 },
                    { name: "reason", label: "Note", span: 4 },
                  ]} />
                <FormDialog action={stockMoveAction} title="Issue stock to a department" trigger="Issue" triggerVariant="secondary"
                  fields={[
                    { name: "type", label: "", type: "hidden", defaultValue: "ISSUE" },
                    { name: "itemId", label: "Item", type: "select", options: itemOpts, required: true, span: 4, empty: "Choose…" },
                    { name: "locationId", label: "From", type: "select", options: locOpts, required: true, defaultValue: main },
                    { name: "department", label: "To department", type: "select", options: DEPTS, required: true, defaultValue: "Housekeeping" },
                    { name: "quantity", label: "Quantity", type: "number", step: "0.001", required: true },
                    { name: "date", label: "Date", type: "date", required: true, defaultValue: today },
                    { name: "reason", label: "Note", span: 4 },
                  ]} />
                <FormDialog action={stockMoveAction} title="Move stock between stores" trigger="Transfer" triggerVariant="secondary"
                  fields={[
                    { name: "type", label: "", type: "hidden", defaultValue: "TRANSFER" },
                    { name: "itemId", label: "Item", type: "select", options: itemOpts, required: true, span: 4, empty: "Choose…" },
                    { name: "fromLocationId", label: "From", type: "select", options: locOpts, required: true, defaultValue: main },
                    { name: "toLocationId", label: "To", type: "select", options: locOpts, required: true },
                    { name: "quantity", label: "Quantity", type: "number", step: "0.001", required: true },
                    { name: "date", label: "Date", type: "date", required: true, defaultValue: today },
                  ]} />
              </>
            )}
            {canCount && active.length > 0 && (
              <FormDialog action={stockMoveAction} title="Record a stock count" trigger="Stock count" triggerVariant="secondary" description="The difference from the system quantity is posted as a stock gain or loss (5900)."
                fields={[
                  { name: "type", label: "", type: "hidden", defaultValue: "ADJUST" },
                  { name: "itemId", label: "Item", type: "select", options: itemOpts, required: true, span: 4, empty: "Choose…" },
                  { name: "locationId", label: "Location", type: "select", options: locOpts, required: true, defaultValue: main },
                  { name: "countedQty", label: "Counted quantity", type: "number", step: "0.001", required: true },
                  { name: "date", label: "Date", type: "date", required: true, defaultValue: today },
                  { name: "reason", label: "Reason", required: true, placeholder: "Monthly count", span: 3 },
                ]} />
            )}
            {canCreate && <FormDialog action={saveItemAction} title="New stock item" trigger="New item" fields={itemFields()} />}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Stock value" value={money(value)} hint={D(ledger[0]?.net).equals(value.toDecimalPlaces(2)) ? "Agrees with ledger 1200" : `Ledger 1200: ${money(ledger[0]?.net)}`} />
        <Stat label="Items" value={active.length} />
        <Stat label="Low stock" value={low.length} tone={low.length ? "danger" : "ok"} />
        <Stat label="Store locations" value={locations.length} />
      </div>
      <Tabs active={tab} items={[
        { key: "stock", label: "Stock on hand", href: "/inventory?tab=stock" },
        { key: "low", label: "Low stock", href: "/inventory?tab=low", count: low.length },
        { key: "moves", label: "Movements", href: "/inventory?tab=moves" },
        { key: "locations", label: "Locations", href: "/inventory?tab=locations" },
      ]} />

      {(tab === "stock" || tab === "low") && (
        <Card>
          {tab === "stock" && (
            <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
              <a href="/inventory?tab=stock" className={cn("rounded-full px-2.5 py-1 text-xs", !sp.category ? "bg-brand-soft text-brand" : "hover:bg-muted")}>All</a>
              {CATS.map(([k, l]) => <a key={k} href={`/inventory?tab=stock&category=${k}`} className={cn("rounded-full px-2.5 py-1 text-xs", sp.category === k ? "bg-brand-soft text-brand" : "hover:bg-muted")}>{l}</a>)}
            </div>
          )}
          {shown.length === 0 ? <EmptyState title={tab === "low" ? "Nothing is low on stock" : "No items"} /> : (
            <Table>
              <THead><tr><TH>Item</TH><TH>Category</TH><TH>By location</TH><TH className="text-right">On hand</TH><TH className="text-right">Reorder at</TH><TH className="text-right">Avg cost</TH><TH className="text-right">Value</TH><TH /></tr></THead>
              <TBody>
                {shown.map((i) => {
                  const q = stockOnHand(i);
                  const isLow = D(i.reorderLevel).greaterThan(0) && q.lessThanOrEqualTo(i.reorderLevel);
                  return (
                    <TR key={i.id} className={cn(!i.isActive && "text-ink-3")}>
                      <TD><div className="font-medium">{i.name}</div><div className="font-mono text-[11px] text-ink-3">{i.sku}</div></TD>
                      <TD className="text-xs">{INVENTORY_CATEGORIES[i.category]?.label ?? i.category}</TD>
                      <TD className="text-xs text-ink-2">{i.levels.filter((l) => !D(l.quantity).isZero()).map((l) => `${l.location.name}: ${D(l.quantity).toString()}`).join(" · ") || "—"}</TD>
                      <TD className={cn("text-right font-medium tabular-nums", isLow && "text-danger")}>{q.toString()} {i.unit}</TD>
                      <TD className="text-right tabular-nums text-ink-3">{D(i.reorderLevel).toString()}</TD>
                      <TD className="text-right tabular-nums">{money(i.avgCost)}</TD>
                      <TD className="text-right tabular-nums">{money(q.times(i.avgCost))}</TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          {isLow && <Badge tone="danger">Low</Badge>}
                          {isLow && canRequest && (
                            <FormDialog action={purchaseRequestAction} title={`Request ${i.name}`} trigger="Request" triggerVariant="ghost"
                              fields={[{ name: "itemId", label: "", type: "hidden", defaultValue: i.id }, { name: "quantity", label: `Quantity (${i.unit})`, type: "number", step: "0.001", required: true, defaultValue: D(i.reorderLevel).times(2).toString() }, { name: "department", label: "Department", type: "select", options: DEPTS }, { name: "reason", label: "Reason", span: 4, defaultValue: "Below reorder level" }]} />
                          )}
                          {canEdit && <FormDialog action={saveItemAction} title={`Edit ${i.name}`} trigger="Edit" triggerVariant="ghost" fields={itemFields(i)} />}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "moves" && (
        <Card>
          {txns.length === 0 ? <EmptyState title="No stock movements yet" /> : (
            <Table>
              <THead><tr><TH>No.</TH><TH>Date</TH><TH>Type</TH><TH>Item</TH><TH>From → To</TH><TH className="text-right">Qty</TH><TH className="text-right">Value</TH><TH>Note</TH></tr></THead>
              <TBody>
                {txns.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs">{t.number}</TD>
                    <TD className="text-xs">{formatDate(t.date)}</TD>
                    <TD><StatusBadge status={t.type} /></TD>
                    <TD className="text-sm">{t.item.name}</TD>
                    <TD className="text-xs">{t.fromLocation?.name ?? "—"} → {t.toLocation?.name ?? t.department ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{D(t.quantity).toString()} {t.item.unit}</TD>
                    <TD className="text-right tabular-nums">{money(t.totalCost)}</TD>
                    <TD className="max-w-xs text-xs text-ink-3">{t.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "locations" && (
        <Card>
          <CardHeader title="Store locations" actions={canEdit && <FormDialog action={saveLocationAction} title="New location" trigger="Add location" fields={[{ name: "code", label: "Code", required: true, span: 1 }, { name: "name", label: "Name", required: true, span: 3 }]} />} />
          <Table>
            <THead><tr><TH>Code</TH><TH>Name</TH><TH className="text-right">Items stocked</TH><TH className="text-right">Value</TH></tr></THead>
            <TBody>
              {locations.map((l) => {
                const here = items.flatMap((i) => i.levels.filter((x) => x.locationId === l.id && !D(x.quantity).isZero()).map((x) => ({ q: D(x.quantity), c: i.avgCost })));
                return <TR key={l.id}><TD className="font-mono text-xs">{l.code}</TD><TD>{l.name}</TD><TD className="text-right tabular-nums">{here.length}</TD><TD className="text-right tabular-nums">{money(sum(here.map((h) => h.q.times(h.c))))}</TD></TR>;
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
