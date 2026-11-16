import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { D, round2, sum } from "@/lib/money";
import { ACC, cashAccountFor, postJournal } from "./ledger";
import { assert, audit, lockProperty, nextNumber, notify, pad, type Actor } from "./common";
import { receiveStock } from "./inventory";

/**
 * A supplier bill (accounts payable): Dr `debitAccount` (Inventory or an expense) / Cr 2000 Accounts Payable.
 * Due date follows the supplier's payment terms.
 */
export async function createBill(
  tx: Tx,
  actor: Actor,
  input: { supplierId: string; amount: Prisma.Decimal.Value; description: string; billDate: Date; debitAccount: string; sourceType: string; sourceId: string; supplierRef?: string | null; receiptId?: string | null },
) {
  const s = await tx.supplier.findFirst({ where: { id: input.supplierId, propertyId: actor.propertyId } });
  assert(s, "Supplier not found.");
  const amount = round2(input.amount);
  assert(amount.greaterThan(0), "The bill amount must be greater than zero.");
  const n = await nextNumber(tx, actor.propertyId, "BILL");
  const bill = await tx.supplierBill.create({
    data: {
      propertyId: actor.propertyId, number: `BILL-${pad(n, 5)}`, supplierId: s.id, receiptId: input.receiptId ?? null, supplierRef: input.supplierRef ?? null,
      description: input.description, billDate: input.billDate, dueDate: addDays(input.billDate, s.paymentTermsDays), amount,
    },
  });
  const entry = await postJournal(tx, actor, {
    date: input.billDate, memo: `${bill.number} ${s.name}: ${input.description}`, sourceType: "BILL", sourceId: bill.id,
    lines: [{ account: input.debitAccount, debit: amount }, { account: ACC.AP, credit: amount }],
  });
  await audit(tx, actor, "bill.create", "SupplierBill", bill.id, `${bill.number} from ${s.name}: ${amount.toFixed(2)}`);
  return { bill, entry };
}

/** Pay a supplier bill (in full or part): Dr 2000 Accounts Payable / Cr Cash or Bank. */
export async function paySupplierBill(tx: Tx, actor: Actor, input: { billId: string; amount: Prisma.Decimal.Value; method: PaymentMethod; date: Date; reference?: string | null }) {
  const bill = await tx.supplierBill.findFirst({ where: { id: input.billId, propertyId: actor.propertyId }, include: { supplier: true } });
  assert(bill, "Bill not found.");
  const amount = round2(input.amount);
  assert(amount.greaterThan(0), "Enter an amount to pay.");
  const owed = D(bill.amount).minus(bill.paid);
  assert(amount.lessThanOrEqualTo(owed), `Only ${owed.toFixed(2)} is still owed on ${bill.number}.`);
  const payment = await tx.supplierPayment.create({ data: { billId: bill.id, date: input.date, amount, method: input.method, reference: input.reference ?? null, createdById: actor.userId } });
  const e = await postJournal(tx, actor, {
    date: input.date, memo: `Payment to ${bill.supplier.name} for ${bill.number}`, sourceType: "SUPPLIER_PAYMENT", sourceId: payment.id,
    lines: [{ account: ACC.AP, debit: amount }, { account: cashAccountFor(input.method), credit: amount }],
  });
  await tx.supplierPayment.update({ where: { id: payment.id }, data: { journalEntryId: e.id } });
  const paid = D(bill.paid).plus(amount);
  await tx.supplierBill.update({ where: { id: bill.id }, data: { paid, status: paid.equals(bill.amount) ? "PAID" : "PARTIALLY_PAID" } });
  await audit(tx, actor, "bill.pay", "SupplierBill", bill.id, `Paid ${amount.toFixed(2)} on ${bill.number}`);
  return payment;
}

// ─── Purchase requests & orders ───

export async function createPurchaseRequest(tx: Tx, actor: Actor, input: { itemId: string; quantity: number; reason?: string | null; department?: string | null }) {
  const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, propertyId: actor.propertyId } });
  assert(item, "Item not found.");
  assert(input.quantity > 0, "Quantity must be greater than zero.");
  const r = await tx.purchaseRequest.create({ data: { propertyId: actor.propertyId, itemId: item.id, quantity: input.quantity, reason: input.reason ?? null, department: input.department ?? null, requestedById: actor.userId } });
  await notify(tx, actor.propertyId, { type: "PURCHASE_REQUEST", title: `Purchase request: ${item.name} × ${input.quantity}`, link: "/procurement?tab=requests" });
  return r;
}

export async function decidePurchaseRequest(tx: Tx, actor: Actor, id: string, approve: boolean) {
  const r = await tx.purchaseRequest.findFirst({ where: { id, propertyId: actor.propertyId } });
  assert(r && r.status === "PENDING", "This request has already been decided.");
  await tx.purchaseRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date() } });
}

export type PoLineInput = { itemId: string; quantity: number; unitCost: number };

export async function createPurchaseOrder(
  tx: Tx,
  actor: Actor,
  input: { supplierId: string; locationId: string; orderDate: Date; expectedDate?: Date | null; notes?: string | null; lines: PoLineInput[]; requestIds?: string[] },
) {
  const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, propertyId: actor.propertyId, isActive: true } });
  assert(supplier, "Choose an active supplier.");
  await tx.stockLocation.findFirstOrThrow({ where: { id: input.locationId, propertyId: actor.propertyId } });
  const lines = input.lines.filter((l) => l.itemId && l.quantity > 0);
  assert(lines.length > 0, "Add at least one item.");
  const items = await tx.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, propertyId: actor.propertyId } });
  assert(items.length === new Set(lines.map((l) => l.itemId)).size, "One of the items was not found.");
  for (const l of lines) assert(l.unitCost >= 0, "Unit cost cannot be negative.");
  const n = await nextNumber(tx, actor.propertyId, "PO");
  const total = round2(sum(lines.map((l) => D(l.quantity).times(l.unitCost))));
  const po = await tx.purchaseOrder.create({
    data: {
      propertyId: actor.propertyId, number: `PO-${pad(n, 5)}`, supplierId: supplier.id, locationId: input.locationId, orderDate: input.orderDate,
      expectedDate: input.expectedDate ?? null, notes: input.notes ?? null, total, createdById: actor.userId,
      lines: { create: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost })) },
    },
  });
  if (input.requestIds?.length) {
    await tx.purchaseRequest.updateMany({ where: { id: { in: input.requestIds }, propertyId: actor.propertyId, status: "APPROVED" }, data: { status: "ORDERED", purchaseOrderId: po.id } });
  }
  await audit(tx, actor, "po.create", "PurchaseOrder", po.id, `${po.number} to ${supplier.name}: ${total.toFixed(2)}`);
  return po;
}

export async function setPurchaseOrderStatus(tx: Tx, actor: Actor, id: string, to: "SUBMITTED" | "APPROVED" | "CANCELLED") {
  const po = await tx.purchaseOrder.findFirst({ where: { id, propertyId: actor.propertyId }, include: { receipts: true } });
  assert(po, "Purchase order not found.");
  const allowed: Record<string, string[]> = { SUBMITTED: ["DRAFT"], APPROVED: ["DRAFT", "SUBMITTED"], CANCELLED: ["DRAFT", "SUBMITTED", "APPROVED"] };
  assert(allowed[to].includes(po.status), `A ${po.status.toLowerCase().replace("_", " ")} order cannot be ${to.toLowerCase()}.`);
  if (to === "CANCELLED") assert(po.receipts.length === 0, "Goods have been received on this order; it cannot be cancelled.");
  await tx.purchaseOrder.update({ where: { id }, data: { status: to, ...(to === "APPROVED" ? { approvedById: actor.userId, approvedAt: new Date() } : {}) } });
  if (to === "CANCELLED") await tx.purchaseRequest.updateMany({ where: { purchaseOrderId: id }, data: { status: "APPROVED", purchaseOrderId: null } });
  await audit(tx, actor, `po.${to.toLowerCase()}`, "PurchaseOrder", id, `${po.number} ${to.toLowerCase()}`);
}

/**
 * Receive goods against an approved order: stock is added at the received cost (average cost updated),
 * and a supplier bill posts Dr 1200 Inventory / Cr 2000 Accounts Payable.
 */
export async function receiveGoods(
  tx: Tx,
  actor: Actor,
  input: { orderId: string; date: Date; supplierRef?: string | null; notes?: string | null; lines: { poLineId: string; quantity: number; unitCost?: number | null }[] },
) {
  await lockProperty(tx, actor.propertyId, `po:${input.orderId}`);
  const po = await tx.purchaseOrder.findFirst({ where: { id: input.orderId, propertyId: actor.propertyId }, include: { lines: { include: { item: true } }, supplier: true } });
  assert(po, "Purchase order not found.");
  assert(["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status), "Only approved orders can be received.");
  const lines = input.lines.filter((l) => l.quantity > 0);
  assert(lines.length > 0, "Enter the quantity received for at least one item.");
  const n = await nextNumber(tx, actor.propertyId, "GRN");
  const grn = await tx.goodsReceipt.create({ data: { orderId: po.id, number: `GRN-${pad(n, 5)}`, date: input.date, supplierRef: input.supplierRef ?? null, notes: input.notes ?? null, total: 0, receivedById: actor.userId } });
  let total = new Prisma.Decimal(0);
  for (const l of lines) {
    const pl = po.lines.find((x) => x.id === l.poLineId);
    assert(pl, "Line not on this order.");
    const remaining = D(pl.quantity).minus(pl.receivedQty);
    assert(D(l.quantity).lessThanOrEqualTo(remaining), `Only ${remaining.toString()} ${pl.item.unit} of ${pl.item.name} is still to be received.`);
    const cost = l.unitCost ?? Number(pl.unitCost);
    await receiveStock(tx, actor, { itemId: pl.itemId, locationId: po.locationId, quantity: l.quantity, unitCost: cost, date: input.date, sourceType: "GRN", sourceId: grn.id, reason: `${grn.number} / ${po.number}` });
    await tx.goodsReceiptLine.create({ data: { receiptId: grn.id, poLineId: pl.id, quantity: l.quantity, unitCost: cost } });
    await tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { receivedQty: D(pl.receivedQty).plus(l.quantity) } });
    total = total.plus(D(l.quantity).times(cost));
  }
  total = round2(total);
  await tx.goodsReceipt.update({ where: { id: grn.id }, data: { total } });
  if (total.greaterThan(0)) {
    await createBill(tx, actor, { supplierId: po.supplierId, amount: total, description: `Goods received ${grn.number} (${po.number})`, billDate: input.date, debitAccount: ACC.INVENTORY, sourceType: "GRN", sourceId: grn.id, supplierRef: input.supplierRef, receiptId: grn.id });
  }
  const fresh = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id } });
  const complete = fresh.every((l) => D(l.receivedQty).greaterThanOrEqualTo(l.quantity));
  await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
  await audit(tx, actor, "po.receive", "PurchaseOrder", po.id, `${grn.number}: received ${total.toFixed(2)} on ${po.number}`);
  return grn;
}
