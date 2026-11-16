import { prisma } from "@/lib/db";
import { addDays, toDateOnlyString } from "@/lib/dates";
import { D } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { createPoAction } from "@/server/actions/inventory";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { LinesForm } from "@/components/ui/quick-form";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const ctx = await pageAuth("procurement.create");
  if (!ctx) return <Forbidden />;
  const pid = ctx.property.id;
  const sp = await searchParams;
  const [suppliers, locations, items, approved] = await Promise.all([
    prisma.supplier.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.stockLocation.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.inventoryItem.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.purchaseRequest.findMany({ where: { propertyId: pid, status: "APPROVED", ...(sp.request ? { id: sp.request } : {}) }, include: { item: true } }),
  ]);
  if (!suppliers.length) return (<><PageHeader title="New purchase order" back={{ href: "/procurement", label: "Procurement" }} /><Card><EmptyState title="Add a supplier first" description="Procurement → Suppliers." /></Card></>);
  const rows = approved.length
    ? approved.map((r) => ({ itemId: r.itemId, quantity: D(r.quantity).toString(), unitCost: D(r.item.avgCost).toDecimalPlaces(2).toString() }))
    : 3;
  return (
    <>
      <PageHeader title="New purchase order" description={approved.length ? `Pre-filled from ${approved.length} approved request(s); they are marked ordered when you save.` : "The PO starts as a draft. Approve it before receiving goods."} back={{ href: "/procurement", label: "Procurement" }} />
      <Card>
        <CardBody>
          <LinesForm
            action={createPoAction} submitLabel="Create purchase order" addLabel="Add item" initialRows={rows}
            fields={[
              { name: "supplierId", label: "Supplier", type: "select", options: suppliers.map((s) => [s.id, s.name]), required: true, empty: "Choose…" },
              { name: "locationId", label: "Deliver to", type: "select", options: locations.map((l) => [l.id, l.name]), required: true, defaultValue: locations.find((l) => l.code === "MAIN")?.id },
              { name: "orderDate", label: "Order date", type: "date", required: true, defaultValue: toDateOnlyString(ctx.today), span: 1 },
              { name: "expectedDate", label: "Expected", type: "date", defaultValue: toDateOnlyString(addDays(ctx.today, 3)), span: 1 },
              { name: "notes", label: "Notes", span: 2 },
              ...approved.map((r) => ({ name: "requestId", label: "", type: "hidden" as const, defaultValue: r.id })),
            ]}
            columns={[
              { name: "itemId", label: "Item", type: "select", options: items.map((i) => [i.id, `${i.name} (${i.unit})`]) },
              { name: "quantity", label: "Quantity", type: "number", step: "0.001", width: "9rem" },
              { name: "unitCost", label: "Unit cost", type: "number", step: "0.0001", width: "9rem" },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}
