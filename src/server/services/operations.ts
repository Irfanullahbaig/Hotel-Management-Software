import type { PaymentMethod, Priority } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { D, round2 } from "@/lib/money";
import { cashAccountFor, postJournal } from "./ledger";
import { blockRoom, releaseRoom } from "./rooms";
import { assert, audit, nextNumber, notify, pad, type Actor } from "./common";
import { chargeToRoom, postDirectSale } from "./sales";
import { createBill } from "./purchasing";

// ─── Maintenance ───

export const MAINTENANCE_CATEGORIES = ["ELECTRICAL", "PLUMBING", "HVAC", "FURNITURE", "APPLIANCE", "IT_TV", "STRUCTURAL", "SAFETY", "OTHER"] as const;

export async function createMaintenanceRequest(
  tx: Tx,
  actor: Actor,
  input: { roomId?: string | null; category: string; title: string; description?: string | null; priority: Priority; dueAt?: Date | null; blockUntil?: Date | null; today: Date; scheduleId?: string | null },
) {
  if (input.roomId) await tx.room.findFirstOrThrow({ where: { id: input.roomId, propertyId: actor.propertyId } });
  assert(!input.blockUntil || input.roomId, "Choose a room to take out of service.");
  const n = await nextNumber(tx, actor.propertyId, "MR");
  const req = await tx.maintenanceRequest.create({
    data: {
      propertyId: actor.propertyId, number: `MR-${pad(n, 5)}`, roomId: input.roomId ?? null, category: input.category, title: input.title,
      description: input.description ?? null, priority: input.priority, dueAt: input.dueAt ?? null, blocksRoom: !!input.blockUntil,
      reportedBy: actor.userId, scheduleId: input.scheduleId ?? null,
    },
    include: { room: true },
  });
  if (input.blockUntil && input.roomId) {
    assert(input.blockUntil > input.today, "The out-of-service date must be after today.");
    await blockRoom(tx, actor, { roomId: input.roomId, kind: "UNDER_MAINTENANCE", startDate: input.today, endDate: input.blockUntil, reason: `${req.number}: ${input.title}`, today: input.today });
  }
  await notify(tx, actor.propertyId, { type: "MAINTENANCE", title: `${input.priority === "URGENT" ? "URGENT: " : ""}${input.title}`, body: req.room ? `Room ${req.room.number}` : input.category, link: "/maintenance" });
  await audit(tx, actor, "maintenance.create", "MaintenanceRequest", req.id, `${req.number} ${input.title}${req.room ? ` (room ${req.room.number})` : ""}`);
  return req;
}

export async function assignMaintenance(tx: Tx, actor: Actor, id: string, assigneeId: string | null) {
  const r = await tx.maintenanceRequest.findFirstOrThrow({ where: { id, propertyId: actor.propertyId } });
  assert(!["COMPLETED", "CANCELLED"].includes(r.status), "This request is closed.");
  if (assigneeId) {
    const ok = await tx.userProperty.findFirst({ where: { userId: assigneeId, propertyId: actor.propertyId, user: { status: "ACTIVE" } } });
    assert(ok, "That person does not work at this property.");
    await notify(tx, actor.propertyId, { userId: assigneeId, type: "MAINTENANCE_ASSIGNED", title: `Assigned: ${r.title}`, link: "/maintenance" });
  }
  await tx.maintenanceRequest.update({ where: { id }, data: { assigneeId, status: assigneeId ? (r.status === "PENDING" ? "ASSIGNED" : r.status) : "PENDING" } });
  await audit(tx, actor, "maintenance.assign", "MaintenanceRequest", id, `${r.number ?? r.title} ${assigneeId ? "assigned" : "unassigned"}`);
}

export async function startMaintenance(tx: Tx, actor: Actor, id: string) {
  const r = await tx.maintenanceRequest.findFirstOrThrow({ where: { id, propertyId: actor.propertyId } });
  assert(["PENDING", "ASSIGNED"].includes(r.status), "This request has already started or is closed.");
  await tx.maintenanceRequest.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date(), assigneeId: r.assigneeId ?? actor.userId } });
}

/**
 * Close a request. A repair cost is expensed: Dr 5400 Maintenance / Cr Cash, Bank or (on account) a supplier bill.
 * A room taken out of service returns to sale via inspection.
 */
export async function resolveMaintenance(
  tx: Tx,
  actor: Actor,
  input: { id: string; resolution: string; cost: number; paidBy?: "CASH" | "BANK_TRANSFER" | "ON_ACCOUNT" | null; supplierId?: string | null; today: Date },
) {
  const r = await tx.maintenanceRequest.findFirstOrThrow({ where: { id: input.id, propertyId: actor.propertyId }, include: { room: true } });
  assert(!["COMPLETED", "CANCELLED"].includes(r.status), "This request is already closed.");
  const cost = round2(input.cost);
  let costEntryId: string | null = null;
  if (cost.greaterThan(0)) {
    assert(input.paidBy, "Say how the repair cost was paid.");
    if (input.paidBy === "ON_ACCOUNT") {
      assert(input.supplierId, "Choose the supplier who will bill this repair.");
      const { entry } = await createBill(tx, actor, { supplierId: input.supplierId, amount: cost, description: `${r.number ?? "Repair"}: ${r.title}`, billDate: input.today, debitAccount: "5400", sourceType: "MAINTENANCE", sourceId: r.id });
      costEntryId = entry.id;
    } else {
      const e = await postJournal(tx, actor, {
        date: input.today, memo: `Repair ${r.number ?? ""} ${r.title}`.trim(), sourceType: "MAINTENANCE", sourceId: r.id,
        lines: [{ account: "5400", debit: cost }, { account: cashAccountFor(input.paidBy as PaymentMethod), credit: cost }],
      });
      costEntryId = e.id;
    }
  }
  await tx.maintenanceRequest.update({ where: { id: r.id }, data: { status: "COMPLETED", resolution: input.resolution, resolvedAt: new Date(), cost, costPaidBy: cost.greaterThan(0) ? input.paidBy : null, costEntryId } });
  if (r.roomId && r.room && r.room.serviceStatus === "UNDER_MAINTENANCE") {
    const others = await tx.maintenanceRequest.count({ where: { roomId: r.roomId, blocksRoom: true, status: { notIn: ["COMPLETED", "CANCELLED"] }, id: { not: r.id } } });
    if (!others) await releaseRoom(tx, actor, r.roomId, input.today);
  }
  await audit(tx, actor, "maintenance.resolve", "MaintenanceRequest", r.id, `${r.number ?? r.title} resolved${cost.greaterThan(0) ? `, cost ${cost.toFixed(2)}` : ""}`);
}

export async function cancelMaintenance(tx: Tx, actor: Actor, id: string, today: Date) {
  const r = await tx.maintenanceRequest.findFirstOrThrow({ where: { id, propertyId: actor.propertyId }, include: { room: true } });
  assert(!["COMPLETED", "CANCELLED"].includes(r.status), "This request is already closed.");
  await tx.maintenanceRequest.update({ where: { id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  if (r.roomId && r.blocksRoom && r.room?.serviceStatus === "UNDER_MAINTENANCE") await releaseRoom(tx, actor, r.roomId, today);
  await audit(tx, actor, "maintenance.cancel", "MaintenanceRequest", id, `${r.number ?? r.title} cancelled`);
}

/** Create requests for preventive schedules that are due, and move each schedule forward. */
export async function generateDueMaintenance(tx: Tx, actor: Actor, today: Date) {
  const due = await tx.maintenanceSchedule.findMany({ where: { propertyId: actor.propertyId, isActive: true, nextDue: { lte: today } } });
  for (const s of due) {
    await createMaintenanceRequest(tx, actor, { roomId: s.roomId, category: s.category, title: `Preventive: ${s.title}`, description: s.equipment ? `Equipment: ${s.equipment}` : null, priority: s.priority, today, scheduleId: s.id, dueAt: addDays(today, 3) });
    let next = s.nextDue;
    while (next <= today) next = addDays(next, s.everyDays);
    await tx.maintenanceSchedule.update({ where: { id: s.id }, data: { nextDue: next } });
  }
  return due.length;
}

// ─── Guest services ───

export const SERVICE_CATEGORIES: Record<string, { label: string; account: string }> = {
  LAUNDRY: { label: "Laundry", account: "4200" },
  SPA: { label: "Spa & wellness", account: "4500" },
  TRANSPORT: { label: "Transport", account: "4600" },
  CONFERENCE: { label: "Business & conference", account: "4300" },
  OTHER: { label: "Other services", account: "4600" },
};

export async function createServiceOrder(
  tx: Tx,
  actor: Actor,
  input: { serviceItemId: string; quantity: number; reservationId?: string | null; guestName?: string | null; chargeTo: "ROOM" | "DIRECT"; scheduledFor?: Date | null; notes?: string | null },
) {
  const item = await tx.serviceItem.findFirst({ where: { id: input.serviceItemId, propertyId: actor.propertyId, isActive: true } });
  assert(item, "Choose a service.");
  assert(input.quantity >= 1, "Quantity must be at least 1.");
  let guestName = input.guestName?.trim() || "";
  let roomNumber: string | null = null;
  if (input.chargeTo === "ROOM") {
    assert(input.reservationId, "Choose the in-house guest to charge.");
    const res = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId: actor.propertyId, status: "CHECKED_IN" }, include: { guest: true, rooms: { include: { room: true } } } });
    assert(res, "That guest is not checked in.");
    guestName = `${res.guest.firstName} ${res.guest.lastName}`;
    roomNumber = res.rooms.find((l) => l.status === "CHECKED_IN")?.room?.number ?? null;
  }
  assert(guestName, "Enter the guest's name.");
  const n = await nextNumber(tx, actor.propertyId, "SO");
  const amount = round2(D(item.price).times(input.quantity));
  const o = await tx.serviceOrder.create({
    data: {
      propertyId: actor.propertyId, number: `SO-${pad(n, 5)}`, serviceItemId: item.id, quantity: input.quantity, unitPrice: item.price, amount,
      reservationId: input.chargeTo === "ROOM" ? input.reservationId : null, guestName, roomNumber, chargeTo: input.chargeTo,
      scheduledFor: input.scheduledFor ?? null, notes: input.notes ?? null, createdById: actor.userId,
    },
  });
  await audit(tx, actor, "service.order", "ServiceOrder", o.id, `${o.number} ${item.name} × ${input.quantity} for ${guestName}`);
  return o;
}

/** Deliver a service: charges the room folio, or records payment for a direct sale. */
export async function deliverServiceOrder(tx: Tx, actor: Actor, input: { id: string; method?: PaymentMethod | null; today: Date }) {
  const o = await tx.serviceOrder.findFirstOrThrow({ where: { id: input.id, propertyId: actor.propertyId }, include: { serviceItem: true } });
  assert(["REQUESTED", "IN_PROGRESS"].includes(o.status), "This order is already closed.");
  const description = `${o.serviceItem.name}${o.quantity > 1 ? ` × ${o.quantity}` : ""} (${o.number})`;
  let journalEntryId: string | null = null;
  if (D(o.amount).greaterThan(0)) {
    if (o.chargeTo === "ROOM") {
      const { txn } = await chargeToRoom(tx, actor, { reservationId: o.reservationId!, type: "SERVICE", description, amount: o.amount, revenueAccount: o.serviceItem.revenueAccount, sourceType: "SERVICE_ORDER", sourceId: o.id, date: input.today });
      journalEntryId = txn?.journalEntryId ?? null;
    } else {
      assert(input.method, "Choose how the guest paid.");
      const { entry } = await postDirectSale(tx, actor, { amount: o.amount, method: input.method, revenueAccount: o.serviceItem.revenueAccount, memo: description, sourceType: "SERVICE_ORDER", sourceId: o.id, date: input.today });
      journalEntryId = entry.id;
    }
  }
  await tx.serviceOrder.update({ where: { id: o.id }, data: { status: "DELIVERED", deliveredAt: new Date(), paymentMethod: o.chargeTo === "DIRECT" ? input.method : null, journalEntryId } });
  await audit(tx, actor, "service.deliver", "ServiceOrder", o.id, `${o.number} delivered${o.chargeTo === "ROOM" ? ` and charged to room ${o.roomNumber ?? ""}` : ""}`);
}

export async function setServiceOrderStatus(tx: Tx, actor: Actor, id: string, status: "IN_PROGRESS" | "CANCELLED") {
  const o = await tx.serviceOrder.findFirstOrThrow({ where: { id, propertyId: actor.propertyId } });
  assert(["REQUESTED", "IN_PROGRESS"].includes(o.status), "This order is already closed.");
  await tx.serviceOrder.update({ where: { id }, data: { status } });
  await audit(tx, actor, `service.${status.toLowerCase()}`, "ServiceOrder", id, `${o.number} ${status.toLowerCase().replace("_", " ")}`);
}

