import type { KitchenStatus, PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2, sum } from "@/lib/money";
import { ACC } from "./ledger";
import { postDiscount } from "./folio";
import { chargeBreakdown } from "./pricing";
import { assert, audit, nextNumber, pad, type Actor } from "./common";
import { chargeToRoom, postDirectSale } from "./sales";

async function openOrder(tx: Tx, actor: Actor, id: string) {
  const o = await tx.posOrder.findFirst({ where: { id, propertyId: actor.propertyId }, include: { items: true, outlet: true } });
  assert(o, "Order not found.");
  assert(o.status === "OPEN", "This order is already closed.");
  return o;
}

/** Recompute order totals from live items with the property's service charge and tax. */
export async function refreshOrderTotals(tx: Tx, orderId: string) {
  const o = await tx.posOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: { where: { status: { not: "VOID" } } }, property: true } });
  const subtotal = sum(o.items.map((i) => i.amount));
  const net = subtotal.minus(o.discount).greaterThan(0) ? subtotal.minus(o.discount) : ZERO;
  const b = chargeBreakdown(net, o.property.serviceChargeRate, o.property.taxRate);
  return tx.posOrder.update({ where: { id: o.id }, data: { subtotal, serviceCharge: b.service, tax: b.tax, total: b.total } });
}

export async function createPosOrder(
  tx: Tx,
  actor: Actor,
  input: { outletId: string; kind: "DINE_IN" | "TAKEAWAY" | "ROOM_SERVICE"; tableId?: string | null; reservationId?: string | null; guestName?: string | null; covers: number },
) {
  const outlet = await tx.outlet.findFirst({ where: { id: input.outletId, propertyId: actor.propertyId, isActive: true } });
  assert(outlet, "Choose an outlet.");
  let roomNumber: string | null = null;
  let guestName = input.guestName?.trim() || null;
  if (input.kind === "DINE_IN") {
    assert(input.tableId, "Choose a table.");
    const t = await tx.diningTable.findFirst({ where: { id: input.tableId, outletId: outlet.id } });
    assert(t, "That table belongs to another outlet.");
    const busy = await tx.posOrder.findFirst({ where: { tableId: t.id, status: "OPEN" } });
    assert(!busy, `Table ${t.name} already has an open order (${busy?.number}).`);
  }
  if (input.kind === "ROOM_SERVICE" || input.reservationId) {
    assert(input.reservationId, "Choose the in-house guest for room service.");
    const res = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId: actor.propertyId, status: "CHECKED_IN" }, include: { guest: true, rooms: { include: { room: true } } } });
    assert(res, "That guest is not checked in.");
    guestName = `${res.guest.firstName} ${res.guest.lastName}`;
    roomNumber = res.rooms.find((l) => l.status === "CHECKED_IN")?.room?.number ?? null;
  }
  const n = await nextNumber(tx, actor.propertyId, "POS");
  const o = await tx.posOrder.create({
    data: {
      propertyId: actor.propertyId, number: `ORD-${pad(n, 5)}`, outletId: outlet.id, tableId: input.kind === "DINE_IN" ? input.tableId : null, kind: input.kind,
      reservationId: input.reservationId ?? null, guestName, roomNumber, covers: Math.max(1, input.covers), openedById: actor.userId,
    },
  });
  await audit(tx, actor, "pos.open", "PosOrder", o.id, `Opened ${o.number} at ${outlet.name}`);
  return o;
}

export async function addOrderItem(tx: Tx, actor: Actor, input: { orderId: string; menuItemId: string; quantity: number; notes?: string | null }) {
  const o = await openOrder(tx, actor, input.orderId);
  const m = await tx.menuItem.findFirst({ where: { id: input.menuItemId, category: { propertyId: actor.propertyId } } });
  assert(m, "Menu item not found.");
  assert(m.isAvailable, `${m.name} is not available right now.`);
  assert(input.quantity >= 1 && input.quantity <= 100, "Enter a quantity between 1 and 100.");
  await tx.posOrderItem.create({ data: { orderId: o.id, menuItemId: m.id, name: m.name, station: m.station, quantity: input.quantity, unitPrice: m.price, amount: round2(D(m.price).times(input.quantity)), notes: input.notes ?? null } });
  await refreshOrderTotals(tx, o.id);
}

export async function voidOrderItem(tx: Tx, actor: Actor, itemId: string, reason: string) {
  const item = await tx.posOrderItem.findUniqueOrThrow({ where: { id: itemId } });
  const o = await openOrder(tx, actor, item.orderId);
  assert(item.status !== "VOID", "Already voided.");
  await tx.posOrderItem.update({ where: { id: item.id }, data: { status: "VOID", notes: [item.notes, `Void: ${reason}`].filter(Boolean).join(" · ") } });
  await refreshOrderTotals(tx, o.id);
  await audit(tx, actor, "pos.void_item", "PosOrder", o.id, `Voided ${item.quantity} × ${item.name} on ${o.number}: ${reason}`);
}

export async function setOrderDiscount(tx: Tx, actor: Actor, orderId: string, amount: number) {
  const o = await openOrder(tx, actor, orderId);
  const d = round2(amount);
  assert(!d.isNegative(), "Discount cannot be negative.");
  const items = sum(o.items.filter((i) => i.status !== "VOID").map((i) => i.amount));
  assert(d.lessThanOrEqualTo(items), "Discount cannot exceed the order subtotal.");
  await tx.posOrder.update({ where: { id: o.id }, data: { discount: d } });
  await refreshOrderTotals(tx, o.id);
  await audit(tx, actor, "pos.discount", "PosOrder", o.id, `Discount ${d.toFixed(2)} on ${o.number}`);
}

export async function setKitchenStatus(tx: Tx, actor: Actor, itemId: string, status: KitchenStatus) {
  const item = await tx.posOrderItem.findUniqueOrThrow({ where: { id: itemId }, include: { order: true } });
  assert(item.order.propertyId === actor.propertyId, "Item belongs to another property.");
  assert(item.status !== "VOID", "This item was voided.");
  await tx.posOrderItem.update({ where: { id: itemId }, data: { status, readyAt: status === "READY" ? new Date() : item.readyAt } });
}

/**
 * Settle an order.
 *  - To a room: the folio is charged (Dr AR / Cr Restaurant revenue, service charge, tax); any discount is a folio discount.
 *  - Paid now: Dr Cash/Bank / Cr Restaurant revenue, service charge, tax (net of discount).
 */
export async function settleOrder(tx: Tx, actor: Actor, input: { orderId: string; to: "ROOM" | "PAYMENT"; method?: PaymentMethod | null; reservationId?: string | null; today: Date }) {
  const o = await openOrder(tx, actor, input.orderId);
  await refreshOrderTotals(tx, o.id);
  const live = o.items.filter((i) => i.status !== "VOID");
  assert(live.length > 0, "Add items before settling, or void the order.");
  const fresh = await tx.posOrder.findUniqueOrThrow({ where: { id: o.id } });
  const label = `${o.outlet.name} ${o.number}`;
  let journalEntryId: string | null = null;
  if (input.to === "ROOM") {
    const reservationId = input.reservationId ?? o.reservationId;
    assert(reservationId, "Choose the in-house guest to charge.");
    const { res, txn } = await chargeToRoom(tx, actor, { reservationId, type: "RESTAURANT", description: label, amount: fresh.subtotal, revenueAccount: o.outlet.revenueAccount, sourceType: "POS", sourceId: o.id, date: input.today });
    if (D(fresh.discount).greaterThan(0)) await postDiscount(tx, actor, res.folio!.id, fresh.discount, input.today, `POS-${o.id}`, `${label} discount`);
    journalEntryId = txn?.journalEntryId ?? null;
    if (!o.reservationId) await tx.posOrder.update({ where: { id: o.id }, data: { reservationId, guestName: `${res.guest.firstName} ${res.guest.lastName}` } });
  } else {
    assert(input.method, "Choose a payment method.");
    const net = D(fresh.subtotal).minus(fresh.discount);
    if (net.greaterThan(0)) {
      const { entry } = await postDirectSale(tx, actor, { amount: net, method: input.method, revenueAccount: o.outlet.revenueAccount || ACC.RESTAURANT_REVENUE, memo: label, sourceType: "POS", sourceId: o.id, date: input.today });
      journalEntryId = entry.id;
    }
  }
  await tx.posOrder.update({ where: { id: o.id }, data: { status: "SETTLED", settledTo: input.to, paymentMethod: input.to === "PAYMENT" ? input.method : null, settledAt: new Date(), settledById: actor.userId, journalEntryId } });
  await tx.posOrderItem.updateMany({ where: { orderId: o.id, status: { in: ["NEW", "PREPARING", "READY"] } }, data: { status: "SERVED" } });
  await audit(tx, actor, "pos.settle", "PosOrder", o.id, `Settled ${o.number} ${input.to === "ROOM" ? "to room" : `by ${input.method?.toLowerCase()}`}: ${D(fresh.total).toFixed(2)}`);
}

export async function voidOrder(tx: Tx, actor: Actor, orderId: string, reason: string) {
  const o = await openOrder(tx, actor, orderId);
  await tx.posOrder.update({ where: { id: o.id }, data: { status: "VOID", voidReason: reason, settledAt: new Date(), settledById: actor.userId } });
  await tx.posOrderItem.updateMany({ where: { orderId: o.id }, data: { status: "VOID" } });
  await audit(tx, actor, "pos.void", "PosOrder", o.id, `Voided ${o.number}: ${reason}`);
}
