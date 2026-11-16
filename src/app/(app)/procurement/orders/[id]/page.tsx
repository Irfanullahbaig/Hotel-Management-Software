import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, toDateOnlyString } from "@/lib/dates";
import { D, formatMoney } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { poStatusAction, receiveGoodsAction } from "@/server/actions/inventory";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PrintButton } from "@/components/ui/print-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LinesForm, PostButton } from "@/components/ui/quick-form";

export const metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("procurement.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, propertyId: ctx.property.id },
    include: { supplier: true, location: true, lines: { include: { item: true } }, receipts: { include: { lines: true, bill: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!po) notFound();
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const remaining = po.lines.filter((l) => D(l.quantity).greaterThan(l.receivedQty));
  const canEdit = ctx.can("procurement.edit");
  const canApprove = ctx.can("procurement.approve");
  const receivable = ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status) && canEdit;
  const lineName = new Map(po.lines.map((l) => [l.id, l.item.name]));
  return (
    <>
      <PageHeader
        title={`${po.number} · ${po.supplier.name}`}
        description={`Deliver to ${po.location.name}`}
        back={{ href: "/procurement", label: "Procurement" }}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <StatusBadge status={po.status} />
            {po.status === "DRAFT" && canEdit && <PostButton action={poStatusAction} fields={{ id: po.id, to: "SUBMITTED" }} label="Submit for approval" />}
            {["DRAFT", "SUBMITTED"].includes(po.status) && canApprove && <PostButton action={poStatusAction} fields={{ id: po.id, to: "APPROVED" }} label="Approve" variant="primary" />}
            {["DRAFT", "SUBMITTED", "APPROVED"].includes(po.status) && po.receipts.length === 0 && canEdit && <PostButton action={poStatusAction} fields={{ id: po.id, to: "CANCELLED" }} label="Cancel" variant="ghost" confirm="Cancel this purchase order?" />}
            <PrintButton />
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Lines" />
          <Table>
            <THead><tr><TH>Item</TH><TH className="text-right">Ordered</TH><TH className="text-right">Received</TH><TH className="text-right">Unit cost</TH><TH className="text-right">Amount</TH></tr></THead>
            <TBody>
              {po.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="font-medium">{l.item.name}<div className="font-mono text-[11px] font-normal text-ink-3">{l.item.sku}</div></TD>
                  <TD className="text-right tabular-nums">{D(l.quantity).toString()} {l.item.unit}</TD>
                  <TD className={`text-right tabular-nums ${D(l.receivedQty).greaterThanOrEqualTo(l.quantity) ? "text-ok" : ""}`}>{D(l.receivedQty).toString()}</TD>
                  <TD className="text-right tabular-nums">{money(l.unitCost)}</TD>
                  <TD className="text-right tabular-nums">{money(D(l.quantity).times(l.unitCost))}</TD>
                </TR>
              ))}
              <TR className="bg-muted/50 font-semibold"><TD colSpan={4}>Total</TD><TD className="text-right tabular-nums">{money(po.total)}</TD></TR>
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList items={[
              ["Supplier", po.supplier.name], ["Contact", [po.supplier.contactName, po.supplier.phone].filter(Boolean).join(" · ") || "—"], ["Payment terms", `${po.supplier.paymentTermsDays} days`],
              ["Order date", formatDate(po.orderDate)], ["Expected", po.expectedDate ? formatDate(po.expectedDate) : "—"], ["Approved", po.approvedAt ? formatDate(po.approvedAt) : "—"], ["Notes", po.notes ?? "—"],
            ]} />
          </CardBody>
        </Card>
      </div>
      {receivable && remaining.length > 0 && (
        <Card className="mt-4 print:hidden">
          <CardHeader title="Receive goods" description="Enter what actually arrived. Stock is added at this cost and a supplier bill is raised for the received value." />
          <CardBody>
            <LinesForm
              action={receiveGoodsAction} submitLabel="Receive" addLabel="Add line"
              initialRows={remaining.map((l) => ({ poLineId: l.id, receiveQty: D(l.quantity).minus(l.receivedQty).toString(), receiveCost: D(l.unitCost).toDecimalPlaces(4).toString() }))}
              fields={[
                { name: "orderId", label: "", type: "hidden", defaultValue: po.id },
                { name: "date", label: "Received on", type: "date", required: true, defaultValue: toDateOnlyString(ctx.today), span: 1 },
                { name: "supplierRef", label: "Supplier invoice / delivery note", span: 1 },
                { name: "notes", label: "Notes", span: 2 },
              ]}
              columns={[
                { name: "poLineId", label: "Item", type: "select", options: remaining.map((l) => [l.id, `${l.item.name} (${D(l.quantity).minus(l.receivedQty).toString()} ${l.item.unit} due)`]) },
                { name: "receiveQty", label: "Qty received", type: "number", step: "0.001", width: "9rem" },
                { name: "receiveCost", label: "Unit cost", type: "number", step: "0.0001", width: "9rem" },
              ]}
            />
          </CardBody>
        </Card>
      )}
      {po.receipts.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Goods received" />
          <Table>
            <THead><tr><TH>GRN</TH><TH>Date</TH><TH>Items</TH><TH>Supplier ref</TH><TH className="text-right">Value</TH><TH>Bill</TH></tr></THead>
            <TBody>
              {po.receipts.map((g) => (
                <TR key={g.id}>
                  <TD className="font-mono text-xs">{g.number}</TD>
                  <TD className="text-xs">{formatDate(g.date)}</TD>
                  <TD className="text-xs">{g.lines.map((l) => `${lineName.get(l.poLineId)} × ${D(l.quantity).toString()}`).join(", ")}</TD>
                  <TD className="text-xs">{g.supplierRef ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{money(g.total)}</TD>
                  <TD className="text-xs">{g.bill ? <>{g.bill.number} <StatusBadge status={g.bill.status} /></> : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
