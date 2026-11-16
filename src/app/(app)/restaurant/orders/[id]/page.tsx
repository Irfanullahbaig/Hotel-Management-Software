import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { inHouseGuests } from "@/server/services/sales";
import { addOrderItemAction, orderDiscountAction, settleOrderAction, voidOrderAction, voidOrderItemAction } from "@/server/actions/pos";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/print-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, InlineForm, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const METHODS: Opt[] = [["CASH", "Cash"], ["CARD", "Card"], ["MOBILE_WALLET", "Mobile wallet"], ["BANK_TRANSFER", "Bank transfer"]];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("restaurant.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const o = await prisma.posOrder.findFirst({ where: { id, propertyId: ctx.property.id }, include: { outlet: true, table: true, items: { orderBy: { createdAt: "asc" } } } });
  if (!o) notFound();
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const open = o.status === "OPEN";
  const [categories, guests] = open
    ? await Promise.all([
        prisma.menuCategory.findMany({ where: { propertyId: ctx.property.id }, include: { items: { where: { isAvailable: true }, orderBy: { name: "asc" } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
        prisma.$transaction((tx) => inHouseGuests(tx, ctx.property.id)),
      ])
    : [[], []];
  const menuOpts: Opt[] = categories.flatMap((c) => c.items.map((m) => [m.id, `${c.name} · ${m.name} — ${money(m.price)}`] as Opt));
  const canCreate = ctx.can("restaurant.create");
  const canEdit = ctx.can("restaurant.edit");
  const where = o.table ? `Table ${o.table.name}` : o.kind === "ROOM_SERVICE" ? `Room service · Room ${o.roomNumber ?? ""}` : "Takeaway";

  return (
    <>
      <PageHeader
        title={`${o.number} · ${where}`}
        description={`${o.outlet.name} · opened ${formatDateTime(o.openedAt, ctx.property.timeZone)} · ${o.covers} covers${o.guestName ? ` · ${o.guestName}` : ""}`}
        back={{ href: "/restaurant", label: "Restaurant" }}
        actions={<div className="flex items-center gap-2"><StatusBadge status={o.status} /><PrintButton /></div>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {open && canCreate && (
            <Card>
              <CardHeader title="Add to order" description="Items go straight to the kitchen or bar display." />
              <CardBody>
                {menuOpts.length === 0 ? <p className="text-sm text-ink-3">No menu items are available.</p> : (
                  <InlineForm action={addOrderItemAction} submitLabel="Add"
                    fields={[
                      { name: "orderId", label: "", type: "hidden", defaultValue: o.id },
                      { name: "menuItemId", label: "Item", type: "select", options: menuOpts, required: true, span: 2, empty: "Choose…" },
                      { name: "quantity", label: "Qty", type: "number", step: "1", min: 1, defaultValue: 1, required: true, span: 1 },
                      { name: "notes", label: "Note", placeholder: "No onions", span: 1 },
                    ]} />
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Items" />
            {o.items.length === 0 ? <EmptyState title="Nothing ordered yet" /> : (
              <Table>
                <THead><tr><TH>Item</TH><TH className="text-right">Qty</TH><TH className="text-right">Price</TH><TH className="text-right">Amount</TH><TH>Kitchen</TH><TH className="print:hidden" /></tr></THead>
                <TBody>
                  {o.items.map((i) => (
                    <TR key={i.id} className={i.status === "VOID" ? "text-ink-3 line-through" : ""}>
                      <TD><div className="font-medium">{i.name}</div>{i.notes && <div className="text-[11px] text-ink-3 no-underline">{i.notes}</div>}</TD>
                      <TD className="text-right tabular-nums">{i.quantity}</TD>
                      <TD className="text-right tabular-nums">{money(i.unitPrice)}</TD>
                      <TD className="text-right tabular-nums">{money(i.amount)}</TD>
                      <TD><StatusBadge status={i.status} /></TD>
                      <TD className="text-right print:hidden">
                        {open && canEdit && i.status !== "VOID" && (
                          <FormDialog action={voidOrderItemAction} title={`Void ${i.name}`} trigger="Void" triggerVariant="ghost"
                            fields={[{ name: "itemId", label: "", type: "hidden", defaultValue: i.id }, { name: "reason", label: "Reason", required: true, span: 4, placeholder: "Guest changed mind, kitchen error…" }]} />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Bill" />
            <CardBody>
              <DescriptionList items={[
                ["Subtotal", money(o.subtotal)],
                ["Discount", Number(o.discount) ? `− ${money(o.discount)}` : "—"],
                [`Service charge (${ctx.property.serviceChargeRate.toString()}%)`, money(o.serviceCharge)],
                [`Tax (${ctx.property.taxRate.toString()}%)`, money(o.tax)],
                ["Total", <strong key="t" className="text-base">{money(o.total)}</strong>],
                ...(o.status === "SETTLED" ? [["Settled", o.settledTo === "ROOM" ? `Charged to room ${o.roomNumber ?? ""}` : `Paid by ${o.paymentMethod?.toLowerCase().replace("_", " ")}`] as [string, React.ReactNode]] : []),
                ...(o.status === "VOID" ? [["Void reason", o.voidReason ?? "—"] as [string, React.ReactNode]] : []),
              ]} />
            </CardBody>
          </Card>
          {open && (
            <Card className="print:hidden">
              <CardHeader title="Close the order" />
              <CardBody className="flex flex-col gap-2">
                <FormDialog action={settleOrderAction} title="Take payment" trigger={`Take payment · ${money(o.total)}`} triggerSize="md"
                  fields={[{ name: "orderId", label: "", type: "hidden", defaultValue: o.id }, { name: "to", label: "", type: "hidden", defaultValue: "PAYMENT" }, { name: "method", label: "Method", type: "select", options: METHODS, required: true, defaultValue: "CASH", span: 4 }]} />
                {(o.reservationId || guests.length > 0) && (
                  <FormDialog action={settleOrderAction} title="Charge to room" trigger="Charge to room" triggerVariant="secondary" triggerSize="md"
                    description="The bill is added to the guest's folio and paid at check-out."
                    fields={[
                      { name: "orderId", label: "", type: "hidden", defaultValue: o.id }, { name: "to", label: "", type: "hidden", defaultValue: "ROOM" },
                      { name: "reservationId", label: "Guest", type: "select", options: guests.map((g) => [g.reservationId, g.label]), required: true, defaultValue: o.reservationId, span: 4 },
                    ]} />
                )}
                {canEdit && (
                  <div className="flex gap-2 pt-2">
                    <FormDialog action={orderDiscountAction} title="Discount" trigger="Discount" triggerVariant="ghost" description="Amount off the subtotal, before service charge and tax."
                      fields={[{ name: "orderId", label: "", type: "hidden", defaultValue: o.id }, { name: "amount", label: "Amount", type: "number", defaultValue: o.discount.toString(), span: 4 }]} />
                    <FormDialog action={voidOrderAction} title="Void the whole order" trigger="Void order" triggerVariant="danger-outline" submitLabel="Void order"
                      fields={[{ name: "orderId", label: "", type: "hidden", defaultValue: o.id }, { name: "reason", label: "Reason", required: true, span: 4 }]} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
