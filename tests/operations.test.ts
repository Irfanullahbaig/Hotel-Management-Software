import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { addDays } from "@/lib/dates";
import { createReservation } from "@/server/services/reservations";
import { checkIn, checkOut } from "@/server/services/frontdesk";
import { addOrderItem, createPosOrder, setOrderDiscount, settleOrder } from "@/server/services/pos";
import { adjustStock, issueStock, receiveStock } from "@/server/services/inventory";
import { createPurchaseOrder, paySupplierBill, receiveGoods, setPurchaseOrderStatus } from "@/server/services/purchasing";
import { closeBooks, postManualJournal, recordExpense, reopenBooks } from "@/server/services/accounting";
import { addEventItem, completeEvent, createEvent, eventDeposit } from "@/server/services/events";
import { enrollLoyalty, evaluateCoupon, redeemPoints } from "@/server/services/crm";
import { createServiceOrder, deliverServiceOrder } from "@/server/services/operations";
import { bookOnline } from "@/server/services/booking";
import { balances, prisma, resetDb, setupProperty, today } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupProperty>>;
const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn, { timeout: 20000 });
const ledgerSum = async () => Object.values(await balances(ctx.property.id)).reduce((a, b) => a + b, 0);

beforeEach(async () => {
  await resetDb();
  ctx = await setupProperty();
});
afterAll(() => prisma.$disconnect());

async function inHouse(roomIdx = 0) {
  const res = await tx((t) => createReservation(t, ctx.actor, {
    guest: { firstName: "Ann", lastName: "Lee", email: "ann@example.com", idType: "PASSPORT", idNumber: "P1" }, source: "DIRECT", checkIn: today, checkOut: addDays(today, 2),
    rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: `r${Math.random()}`, today,
  }));
  const line = await prisma.reservationRoom.findFirstOrThrow({ where: { reservationId: res.id } });
  await tx((t) => checkIn(t, ctx.actor, { reservationId: res.id, lines: [{ lineId: line.id, roomId: ctx.rooms[roomIdx].id, adults: 1, children: 0 }], documentVerified: true, idempotencyKey: `c${res.id}`, today }));
  return res;
}

async function menu() {
  const outlet = await prisma.outlet.create({ data: { propertyId: ctx.property.id, code: "R", name: "Resto" } });
  const table = await prisma.diningTable.create({ data: { outletId: outlet.id, name: "T1" } });
  const cat = await prisma.menuCategory.create({ data: { propertyId: ctx.property.id, name: "Mains" } });
  const dish = await prisma.menuItem.create({ data: { categoryId: cat.id, name: "Curry", price: 15 } });
  return { outlet, table, dish };
}

describe("restaurant POS", () => {
  it("settles a paid order: cash = total, revenue net of discount, service charge and tax", async () => {
    const { outlet, table, dish } = await menu();
    const o = await tx((t) => createPosOrder(t, ctx.actor, { outletId: outlet.id, kind: "DINE_IN", tableId: table.id, covers: 2 }));
    await tx((t) => addOrderItem(t, ctx.actor, { orderId: o.id, menuItemId: dish.id, quantity: 2 }));
    await expect(tx((t) => createPosOrder(t, ctx.actor, { outletId: outlet.id, kind: "DINE_IN", tableId: table.id, covers: 1 }))).rejects.toThrow(/already has an open order/);
    await tx((t) => setOrderDiscount(t, ctx.actor, o.id, 10));
    await tx((t) => settleOrder(t, ctx.actor, { orderId: o.id, to: "PAYMENT", method: "CASH", today }));
    const done = await prisma.posOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(done.status).toBe("SETTLED");
    expect(Number(done.subtotal)).toBe(30);
    // net 20 → service 5% = 1.00 → tax 10% of 21 = 2.10 → total 23.10
    expect(Number(done.total)).toBe(23.1);
    const b = await balances(ctx.property.id);
    expect(b["1000"]).toBe(23.1);
    expect(b["4100"]).toBe(-20);
    expect(b["4650"]).toBe(-1);
    expect(b["2200"]).toBe(-2.1);
  });

  it("charges an order to an in-house guest's folio", async () => {
    const { outlet, dish } = await menu();
    const res = await inHouse();
    const o = await tx((t) => createPosOrder(t, ctx.actor, { outletId: outlet.id, kind: "ROOM_SERVICE", reservationId: res.id, covers: 1 }));
    expect(o.roomNumber).toBe("101");
    await tx((t) => addOrderItem(t, ctx.actor, { orderId: o.id, menuItemId: dish.id, quantity: 1 }));
    await tx((t) => settleOrder(t, ctx.actor, { orderId: o.id, to: "ROOM", today }));
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: res.id }, include: { transactions: true } });
    expect(folio.transactions.some((x) => x.type === "RESTAURANT" && Number(x.amount) === 15)).toBe(true);
    expect((await balances(ctx.property.id))["4100"]).toBe(-15);
    expect(await ledgerSum()).toBeCloseTo(0, 6);
  });

  it("services charged to the room and paid directly", async () => {
    const res = await inHouse();
    const laundry = await prisma.serviceItem.create({ data: { propertyId: ctx.property.id, category: "LAUNDRY", name: "Shirt", price: 4, revenueAccount: "4200" } });
    const a = await tx((t) => createServiceOrder(t, ctx.actor, { serviceItemId: laundry.id, quantity: 3, reservationId: res.id, chargeTo: "ROOM" }));
    await tx((t) => deliverServiceOrder(t, ctx.actor, { id: a.id, today }));
    const b = await tx((t) => createServiceOrder(t, ctx.actor, { serviceItemId: laundry.id, quantity: 1, guestName: "Visitor", chargeTo: "DIRECT" }));
    await tx((t) => deliverServiceOrder(t, ctx.actor, { id: b.id, method: "CASH", today }));
    expect((await balances(ctx.property.id))["4200"]).toBe(-16);
    await expect(tx((t) => deliverServiceOrder(t, ctx.actor, { id: a.id, today }))).rejects.toThrow(/already closed/);
  });
});

describe("inventory", () => {
  it("keeps weighted-average cost and posts issues at that cost", async () => {
    const loc = await prisma.stockLocation.findFirstOrThrow({ where: { propertyId: ctx.property.id, code: "MAIN" } });
    const item = await prisma.inventoryItem.create({ data: { propertyId: ctx.property.id, sku: "S1", name: "Soap", category: "AMENITIES", expenseAccount: "5300", reorderLevel: 8 } });
    await tx((t) => receiveStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, quantity: 10, unitCost: 2, date: today, creditAccount: "1000" }));
    await tx((t) => receiveStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, quantity: 10, unitCost: 4, date: today, creditAccount: "1000" }));
    expect(Number((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).avgCost)).toBe(3);
    await tx((t) => issueStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, quantity: 5, date: today, department: "Housekeeping" }));
    let b = await balances(ctx.property.id);
    expect(b["1200"]).toBe(45);
    expect(b["5300"]).toBe(15);
    await expect(tx((t) => issueStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, quantity: 100, date: today }))).rejects.toThrow(/Not enough stock/);
    // Count finds 13 instead of 15: 2 × 3 = 6 written off to 5900.
    await tx((t) => adjustStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, countedQty: 13, date: today, reason: "Monthly count" }));
    b = await balances(ctx.property.id);
    expect(b["1200"]).toBe(39);
    expect(b["5900"]).toBe(6);
    expect(await prisma.notification.count({ where: { propertyId: ctx.property.id, type: "LOW_STOCK" } })).toBe(0);
    await tx((t) => issueStock(t, ctx.actor, { itemId: item.id, locationId: loc.id, quantity: 6, date: today }));
    expect(await prisma.notification.count({ where: { propertyId: ctx.property.id, type: "LOW_STOCK" } })).toBe(1);
  });
});

describe("procurement & payables", () => {
  it("receiving against a PO adds stock, raises a bill, and payment clears it", async () => {
    const loc = await prisma.stockLocation.findFirstOrThrow({ where: { propertyId: ctx.property.id, code: "MAIN" } });
    const item = await prisma.inventoryItem.create({ data: { propertyId: ctx.property.id, sku: "R1", name: "Rice", category: "FOOD", expenseAccount: "5200" } });
    const s = await prisma.supplier.create({ data: { propertyId: ctx.property.id, name: "Farm", paymentTermsDays: 10 } });
    const po = await tx((t) => createPurchaseOrder(t, ctx.actor, { supplierId: s.id, locationId: loc.id, orderDate: today, lines: [{ itemId: item.id, quantity: 10, unitCost: 5 }] }));
    await expect(tx((t) => receiveGoods(t, ctx.actor, { orderId: po.id, date: today, lines: [] }))).rejects.toThrow(/approved/);
    await tx((t) => setPurchaseOrderStatus(t, ctx.actor, po.id, "APPROVED"));
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });
    await tx((t) => receiveGoods(t, ctx.actor, { orderId: po.id, date: today, lines: [{ poLineId: line.id, quantity: 6 }] }));
    await expect(tx((t) => receiveGoods(t, ctx.actor, { orderId: po.id, date: today, lines: [{ poLineId: line.id, quantity: 5 }] }))).rejects.toThrow(/Only 4/);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
    const bill = await prisma.supplierBill.findFirstOrThrow({ where: { supplierId: s.id } });
    expect(Number(bill.amount)).toBe(30);
    expect(bill.dueDate.getTime()).toBe(addDays(today, 10).getTime());
    let b = await balances(ctx.property.id);
    expect(b["1200"]).toBe(30);
    expect(b["2000"]).toBe(-30);
    await expect(tx((t) => paySupplierBill(t, ctx.actor, { billId: bill.id, amount: 31, method: "BANK_TRANSFER", date: today }))).rejects.toThrow(/Only 30.00/);
    await tx((t) => paySupplierBill(t, ctx.actor, { billId: bill.id, amount: 30, method: "BANK_TRANSFER", date: today }));
    b = await balances(ctx.property.id);
    expect(b["2000"]).toBe(0);
    expect(b["1010"]).toBe(-30);
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
  });
});

describe("accounting", () => {
  it("expenses paid now and on account", async () => {
    const s = await prisma.supplier.create({ data: { propertyId: ctx.property.id, name: "Power Co" } });
    await tx((t) => recordExpense(t, ctx.actor, { date: today, account: "5100", description: "Electricity", amount: 200, paidBy: "BANK_TRANSFER" }));
    await tx((t) => recordExpense(t, ctx.actor, { date: today, account: "5100", description: "Gas", amount: 50, paidBy: "ON_ACCOUNT", supplierId: s.id }));
    await expect(tx((t) => recordExpense(t, ctx.actor, { date: today, account: "1000", description: "x", amount: 5, paidBy: "CASH" }))).rejects.toThrow(/expense account/);
    const b = await balances(ctx.property.id);
    expect(b["5100"]).toBe(250);
    expect(b["1010"]).toBe(-200);
    expect(b["2000"]).toBe(-50);
  });

  it("manual journals must balance", async () => {
    await expect(tx((t) => postManualJournal(t, ctx.actor, { date: today, memo: "bad", lines: [{ account: "1010", debit: 100, credit: 0 }, { account: "3000", debit: 0, credit: 90 }] }))).rejects.toThrow(/must equal/);
    await tx((t) => postManualJournal(t, ctx.actor, { date: today, memo: "Opening bank", lines: [{ account: "1010", debit: 1000, credit: 0 }, { account: "3000", debit: 0, credit: 1000 }] }));
    expect((await balances(ctx.property.id))["1010"]).toBe(1000);
  });

  it("closed periods reject postings in code and in the database", async () => {
    const yesterday = addDays(today, -1);
    await expect(tx((t) => closeBooks(t, ctx.actor, today, today))).rejects.toThrow(/ended/);
    await tx((t) => closeBooks(t, ctx.actor, yesterday, today));
    await expect(tx((t) => postManualJournal(t, ctx.actor, { date: yesterday, memo: "late", lines: [{ account: "1010", debit: 5, credit: 0 }, { account: "3000", debit: 0, credit: 5 }] }))).rejects.toThrow(/closed/);
    const acct = await prisma.account.findFirstOrThrow({ where: { propertyId: ctx.property.id, code: "1000" } });
    await expect(prisma.journalEntry.create({ data: { propertyId: ctx.property.id, number: "X1", date: yesterday, memo: "bypass", sourceType: "T", sourceId: "1", lines: { create: [{ accountId: acct.id, debit: 0, credit: 0 }] } } })).rejects.toThrow(/closed/);
    await tx((t) => reopenBooks(t, ctx.actor, null));
    await tx((t) => postManualJournal(t, ctx.actor, { date: yesterday, memo: "late", lines: [{ account: "1010", debit: 5, credit: 0 }, { account: "3000", debit: 0, credit: 5 }] }));
  });
});

describe("events", () => {
  it("prevents double-booking a venue and bills through the event folio", async () => {
    const venue = await prisma.eventVenue.create({ data: { propertyId: ctx.property.id, name: "Hall", capacity: 50, hourlyRate: 100 } });
    const base = { venueId: venue.id, title: "Meeting", eventType: "MEETING", clientName: "Acme", date: today, attendees: 10, confirmed: true, today };
    const e = await tx((t) => createEvent(t, ctx.actor, { ...base, startMinute: 9 * 60, endMinute: 12 * 60 }));
    await expect(tx((t) => createEvent(t, ctx.actor, { ...base, startMinute: 11 * 60, endMinute: 13 * 60 }))).rejects.toThrow(/already booked/);
    await expect(tx((t) => createEvent(t, ctx.actor, { ...base, attendees: 51, startMinute: 13 * 60, endMinute: 14 * 60 }))).rejects.toThrow(/at most 50/);
    // The database constraint holds even if the service check is bypassed.
    const folio = await prisma.folio.create({ data: { propertyId: ctx.property.id, number: "F-X" } });
    await expect(prisma.eventBooking.create({ data: { propertyId: ctx.property.id, number: "E-X", venueId: venue.id, title: "x", eventType: "OTHER", clientName: "x", date: today, startMinute: 600, endMinute: 660, attendees: 1, status: "CONFIRMED", folioId: folio.id } })).rejects.toThrow(/event_bookings_no_overlap/);

    await tx((t) => addEventItem(t, ctx.actor, { eventId: e.id, description: "Lunch", quantity: 10, unitPrice: 20, revenueAccount: "4400" }));
    await tx((t) => eventDeposit(t, ctx.actor, { eventId: e.id, amount: 200, method: "BANK_TRANSFER", idempotencyKey: "dep1", today }));
    expect((await balances(ctx.property.id))["2100"]).toBe(-200);
    const inv = await tx((t) => completeEvent(t, ctx.actor, e.id, today));
    // hire 300 + lunch 200 = 500 → +5% service = 525 → +10% tax = 577.50
    expect(Number(inv.total)).toBe(577.5);
    expect(Number(inv.balance)).toBe(377.5);
    const b = await balances(ctx.property.id);
    expect(b["2100"]).toBe(0);
    expect(b["4300"]).toBe(-300);
    expect(b["4400"]).toBe(-200);
    expect(b["1100"]).toBe(377.5);
  });
});

describe("CRM", () => {
  it("members earn points at check-out and redeem them as a folio discount", async () => {
    const res = await inHouse();
    await tx((t) => enrollLoyalty(t, ctx.actor, res.guestId));
    await tx((t) => checkOut(t, ctx.actor, { reservationId: res.id, allowBalance: true, idempotencyKey: "co1", today: addDays(today, 2) }));
    const acct = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { guestId: res.guestId } });
    expect(acct.points).toBe(200); // 2 nights × 100, earn rate 1
    const res2 = await inHouse(1);
    expect(res2.guestId).toBe(res.guestId); // returning guest matched by email
    await expect(tx((t) => redeemPoints(t, ctx.actor, { reservationId: res2.id, points: 100, today }))).rejects.toThrow(/Post some charges/);
    await prisma.$transaction(async (t) => {
      const { nightAudit } = await import("@/server/services/frontdesk");
      await nightAudit(t, ctx.actor, today);
    }, { timeout: 20000 });
    await tx((t) => redeemPoints(t, ctx.actor, { reservationId: res2.id, points: 100, today })); // 100 × 0.01 = 1.00
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { guestId: res.guestId } })).points).toBe(100);
    expect((await balances(ctx.property.id))["4900"]).toBe(1);
    await expect(tx((t) => redeemPoints(t, ctx.actor, { reservationId: res2.id, points: 500, today }))).rejects.toThrow(/Only 100 points/);
  });

  it("promo codes and the public booking engine", async () => {
    await prisma.coupon.create({ data: { propertyId: ctx.property.id, code: "SAVE10", percentOff: 10, minNights: 2, maxUses: 1 } });
    await expect(tx((t) => evaluateCoupon(t, ctx.property.id, { code: "save10", checkIn: today, checkOut: addDays(today, 1), roomTotal: 100 }))).rejects.toThrow(/at least 2 nights/);
    const c = await tx((t) => evaluateCoupon(t, ctx.property.id, { code: "save10", checkIn: today, checkOut: addDays(today, 2), roomTotal: 200 }));
    expect(Number(c.discount)).toBe(20);
    const base = { roomTypeId: ctx.std.id, checkIn: addDays(today, 1), checkOut: addDays(today, 3), adults: 2, children: 0, promo: "SAVE10", firstName: "Web", lastName: "Guest", email: "web@example.com", phone: "123", marketingConsent: true, today };
    const res = await tx((t) => bookOnline(t, ctx.property.id, { ...base, idempotencyKey: "w1" }));
    expect(res.status).toBe("PENDING");
    expect(res.source).toBe("WEBSITE");
    expect(Number(res.discountAmount)).toBe(20);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: res.guestId } })).marketingConsent).toBe(true);
    await expect(tx((t) => bookOnline(t, ctx.property.id, { ...base, idempotencyKey: "w2" }))).rejects.toThrow(/fully used/);
  });
});
