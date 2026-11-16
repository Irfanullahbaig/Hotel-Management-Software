import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { D, formatMoney, sum } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { decideRequestAction, purchaseRequestAction, saveSupplierAction } from "@/server/actions/inventory";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, PostButton, type FieldSpec } from "@/components/ui/quick-form";

export const metadata = { title: "Procurement" };
export const dynamic = "force-dynamic";

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("procurement.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "orders";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const [requests, orders, suppliers, items, openBills] = await Promise.all([
    prisma.purchaseRequest.findMany({ where: { propertyId: pid }, include: { item: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 }),
    prisma.purchaseOrder.findMany({ where: { propertyId: pid }, include: { supplier: true, location: true, _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.supplier.findMany({ where: { propertyId: pid }, include: { bills: { where: { status: { not: "PAID" } }, select: { amount: true, paid: true } }, _count: { select: { purchaseOrders: true } } }, orderBy: { name: "asc" } }),
    prisma.inventoryItem.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
    prisma.supplierBill.findMany({ where: { propertyId: pid, status: { not: "PAID" } }, select: { amount: true, paid: true } }),
  ]);
  const pending = requests.filter((r) => r.status === "PENDING").length;
  const approvedReq = requests.filter((r) => r.status === "APPROVED").length;
  const openPos = orders.filter((o) => ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"].includes(o.status));
  const canCreate = ctx.can("procurement.create");
  const canEdit = ctx.can("procurement.edit");
  const canApprove = ctx.can("procurement.approve");
  const supplierFields = (s?: (typeof suppliers)[number]): FieldSpec[] => [
    ...(s ? [{ name: "id", label: "", type: "hidden" as const, defaultValue: s.id }] : []),
    { name: "name", label: "Company", required: true, span: 4, defaultValue: s?.name },
    { name: "contactName", label: "Contact", defaultValue: s?.contactName },
    { name: "phone", label: "Phone", defaultValue: s?.phone },
    { name: "email", label: "Email", type: "email", defaultValue: s?.email },
    { name: "taxId", label: "Tax ID", defaultValue: s?.taxId },
    { name: "address", label: "Address", span: 3, defaultValue: s?.address },
    { name: "paymentTermsDays", label: "Terms (days)", type: "number", step: "1", required: true, defaultValue: s?.paymentTermsDays ?? 30, span: 1 },
    { name: "isActive", label: "Active", type: s ? "checkbox" : "hidden", defaultValue: s ? s.isActive : "on" },
  ];

  return (
    <>
      <PageHeader
        title="Procurement"
        description="Request → approve → order → receive → pay. Receiving goods updates stock and raises the supplier bill automatically."
        actions={
          <div className="flex gap-2">
            {canCreate && items.length > 0 && (
              <FormDialog action={purchaseRequestAction} title="Request items" trigger="Request items" triggerVariant="secondary"
                fields={[
                  { name: "itemId", label: "Item", type: "select", options: items.map((i) => [i.id, `${i.name} (${i.unit})`]), required: true, span: 4, empty: "Choose…" },
                  { name: "quantity", label: "Quantity", type: "number", step: "0.001", required: true },
                  { name: "department", label: "Department" },
                  { name: "reason", label: "Reason", span: 4 },
                ]} />
            )}
            {canCreate && <LinkButton href="/procurement/orders/new" size="sm">New purchase order</LinkButton>}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Requests awaiting approval" value={pending} tone={pending ? "warn" : undefined} />
        <Stat label="Approved, not ordered" value={approvedReq} tone={approvedReq ? "info" : undefined} />
        <Stat label="Open purchase orders" value={openPos.length} hint={money(sum(openPos.map((o) => o.total)))} />
        <Stat label="Owed to suppliers" value={money(sum(openBills.map((b) => D(b.amount).minus(b.paid))))} hint={<Link href="/finance?tab=ap" className="underline">Pay bills</Link>} />
      </div>
      <Tabs active={tab} items={[
        { key: "orders", label: "Purchase orders", href: "/procurement?tab=orders" },
        { key: "requests", label: "Requests", href: "/procurement?tab=requests", count: pending },
        { key: "suppliers", label: "Suppliers", href: "/procurement?tab=suppliers" },
      ]} />

      {tab === "orders" && (
        <Card>
          {orders.length === 0 ? <EmptyState title="No purchase orders" /> : (
            <Table>
              <THead><tr><TH>PO</TH><TH>Supplier</TH><TH>Deliver to</TH><TH>Ordered</TH><TH>Expected</TH><TH className="text-right">Lines</TH><TH className="text-right">Total</TH><TH>Status</TH></tr></THead>
              <TBody>
                {orders.map((o) => (
                  <TR key={o.id}>
                    <TD><Link href={`/procurement/orders/${o.id}`} className="font-mono text-xs font-medium hover:underline">{o.number}</Link></TD>
                    <TD className="text-sm">{o.supplier.name}</TD>
                    <TD className="text-xs">{o.location.name}</TD>
                    <TD className="text-xs">{formatDate(o.orderDate)}</TD>
                    <TD className="text-xs">{o.expectedDate ? formatDate(o.expectedDate) : "—"}</TD>
                    <TD className="text-right tabular-nums">{o._count.lines}</TD>
                    <TD className="text-right tabular-nums">{money(o.total)}</TD>
                    <TD><StatusBadge status={o.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "requests" && (
        <Card>
          {requests.length === 0 ? <EmptyState title="No purchase requests" /> : (
            <Table>
              <THead><tr><TH>Item</TH><TH className="text-right">Qty</TH><TH>Department</TH><TH>Reason</TH><TH>Requested</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {requests.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.item.name}</TD>
                    <TD className="text-right tabular-nums">{D(r.quantity).toString()} {r.item.unit}</TD>
                    <TD className="text-sm">{r.department ?? "—"}</TD>
                    <TD className="max-w-xs text-xs">{r.reason ?? "—"}</TD>
                    <TD className="text-xs">{formatDate(r.createdAt)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD>
                      {r.status === "PENDING" && canApprove && (
                        <div className="flex justify-end gap-1.5">
                          <PostButton action={decideRequestAction} fields={{ id: r.id, decision: "APPROVE" }} label="Approve" variant="primary" />
                          <PostButton action={decideRequestAction} fields={{ id: r.id, decision: "REJECT" }} label="Reject" variant="ghost" />
                        </div>
                      )}
                      {r.status === "APPROVED" && canCreate && <div className="text-right"><LinkButton href={`/procurement/orders/new?request=${r.id}`} variant="secondary" size="sm">Order</LinkButton></div>}
                      {r.status === "ORDERED" && r.purchaseOrderId && <div className="text-right"><Link href={`/procurement/orders/${r.purchaseOrderId}`} className="text-xs underline">View PO</Link></div>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "suppliers" && (
        <Card>
          <div className="flex justify-end border-b border-border px-4 py-3">{canCreate && <FormDialog action={saveSupplierAction} title="New supplier" trigger="Add supplier" wide fields={supplierFields()} />}</div>
          {suppliers.length === 0 ? <EmptyState title="No suppliers" /> : (
            <Table>
              <THead><tr><TH>Supplier</TH><TH>Contact</TH><TH>Terms</TH><TH className="text-right">Orders</TH><TH className="text-right">Owed</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {suppliers.map((s) => (
                  <TR key={s.id}>
                    <TD><div className="font-medium">{s.name}</div>{s.taxId && <div className="text-[11px] text-ink-3">Tax ID {s.taxId}</div>}</TD>
                    <TD className="text-xs">{[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</TD>
                    <TD className="text-xs">{s.paymentTermsDays} days</TD>
                    <TD className="text-right tabular-nums">{s._count.purchaseOrders}</TD>
                    <TD className="text-right tabular-nums">{money(sum(s.bills.map((b) => D(b.amount).minus(b.paid))))}</TD>
                    <TD><StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">{canEdit && <FormDialog action={saveSupplierAction} title={`Edit ${s.name}`} trigger="Edit" triggerVariant="ghost" wide fields={supplierFields(s)} />}</TD>
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
