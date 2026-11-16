/* Demo data for Phases 2–5: services, restaurant, maintenance, inventory, procurement, accounting, CRM, events, channels. */
import type { PrismaClient } from "@prisma/client";
import { addDays, businessToday } from "@/lib/dates";
import { INVENTORY_CATEGORIES, issueStock, receiveStock } from "@/server/services/inventory";
import { createPurchaseOrder, receiveGoods, setPurchaseOrderStatus, paySupplierBill, createPurchaseRequest } from "@/server/services/purchasing";
import { createMaintenanceRequest, assignMaintenance, resolveMaintenance, createServiceOrder, deliverServiceOrder, SERVICE_CATEGORIES } from "@/server/services/operations";
import { addOrderItem, createPosOrder, setKitchenStatus, settleOrder } from "@/server/services/pos";
import { recordExpense, setBudget } from "@/server/services/accounting";
import { enrollLoyalty, adjustPoints, logFeedback } from "@/server/services/crm";
import { addEventItem, createEvent, eventDeposit } from "@/server/services/events";
import { saveChannel, saveChannelMapping } from "@/server/services/revenue";

const T = { timeout: 60000 };

export async function seedOpsDemo(prisma: PrismaClient, propertyId: string, userId: string) {
  const today = businessToday("UTC");
  const actor = { userId, propertyId };
  const maint = (await prisma.user.findUnique({ where: { email: "maintenance@hms.com" } }))?.id ?? null;

  // ── Services catalog
  const services: [string, string, number][] = [
    ["LAUNDRY", "Shirt — wash & press", 4], ["LAUNDRY", "Suit — dry clean", 15], ["LAUNDRY", "Wash & fold (per kg)", 6],
    ["SPA", "Swedish massage (60 min)", 70], ["SPA", "Facial (45 min)", 55],
    ["TRANSPORT", "Airport transfer (one way)", 35], ["TRANSPORT", "Car with driver (half day)", 90],
    ["CONFERENCE", "Printing (per page)", 0.5], ["OTHER", "Late check-out (until 4 pm)", 30],
  ];
  for (const [cat, name, price] of services) {
    await prisma.serviceItem.upsert({ where: { propertyId_name: { propertyId, name } }, update: {}, create: { propertyId, category: cat, name, price, revenueAccount: SERVICE_CATEGORIES[cat].account } });
  }

  // ── Restaurant
  const main = await prisma.outlet.create({ data: { propertyId, code: "MAIN", name: "Horizon Restaurant", kind: "RESTAURANT" } });
  const bar = await prisma.outlet.create({ data: { propertyId, code: "BAR", name: "Lobby Bar", kind: "BAR" } });
  await prisma.outlet.create({ data: { propertyId, code: "IRD", name: "In-Room Dining", kind: "ROOM_SERVICE" } });
  await prisma.diningTable.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ outletId: main.id, name: `T${i + 1}`, seats: i < 6 ? 4 : 6 })) });
  await prisma.diningTable.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ outletId: bar.id, name: `B${i + 1}`, seats: 2 })) });
  const menu: [string, number, [string, number, string?, string?][]][] = [
    ["Starters", 1, [["Lentil soup", 6], ["Caesar salad", 9, "Romaine, parmesan, croutons"], ["Chicken wings", 10]]],
    ["Mains", 2, [["Grilled salmon", 24, "With seasonal vegetables"], ["Chicken karahi", 18], ["Beef burger", 16, "Fries included"], ["Mushroom risotto", 17]]],
    ["Desserts", 3, [["Chocolate fondant", 8], ["Fruit platter", 7]]],
    ["Beverages", 4, [["Fresh lime soda", 4, undefined, "BAR"], ["Cappuccino", 4.5, undefined, "BAR"], ["Mango smoothie", 6, undefined, "BAR"], ["Mineral water", 2, undefined, "BAR"]]],
  ];
  const mi = new Map<string, string>();
  for (const [cat, order, items] of menu) {
    const c = await prisma.menuCategory.create({ data: { propertyId, name: cat, sortOrder: order } });
    for (const [name, price, description, station] of items) {
      const m = await prisma.menuItem.create({ data: { categoryId: c.id, name, price, description: description ?? null, station: station ?? "KITCHEN" } });
      mi.set(name, m.id);
    }
  }
  const tables = new Map((await prisma.diningTable.findMany({ where: { outletId: main.id } })).map((t) => [t.name, t.id]));
  const inHouse = await prisma.reservation.findFirst({ where: { propertyId, status: "CHECKED_IN" } });

  await prisma.$transaction(async (tx) => {
    // A settled lunch paid by card.
    const o1 = await createPosOrder(tx, actor, { outletId: main.id, kind: "DINE_IN", tableId: tables.get("T2"), covers: 2 });
    await addOrderItem(tx, actor, { orderId: o1.id, menuItemId: mi.get("Grilled salmon")!, quantity: 1 });
    await addOrderItem(tx, actor, { orderId: o1.id, menuItemId: mi.get("Chicken karahi")!, quantity: 1 });
    await addOrderItem(tx, actor, { orderId: o1.id, menuItemId: mi.get("Fresh lime soda")!, quantity: 2 });
    await settleOrder(tx, actor, { orderId: o1.id, to: "PAYMENT", method: "CARD", today });
    // An open dinner table with items at different kitchen stages.
    const o2 = await createPosOrder(tx, actor, { outletId: main.id, kind: "DINE_IN", tableId: tables.get("T5"), covers: 4, guestName: "Walk-in party" });
    await addOrderItem(tx, actor, { orderId: o2.id, menuItemId: mi.get("Lentil soup")!, quantity: 4 });
    await addOrderItem(tx, actor, { orderId: o2.id, menuItemId: mi.get("Beef burger")!, quantity: 2, notes: "One without cheese" });
    await addOrderItem(tx, actor, { orderId: o2.id, menuItemId: mi.get("Mushroom risotto")!, quantity: 2 });
    const soup = await tx.posOrderItem.findFirstOrThrow({ where: { orderId: o2.id, name: "Lentil soup" } });
    await setKitchenStatus(tx, actor, soup.id, "READY");
    const burger = await tx.posOrderItem.findFirstOrThrow({ where: { orderId: o2.id, name: "Beef burger" } });
    await setKitchenStatus(tx, actor, burger.id, "PREPARING");
    if (inHouse) {
      // Room service charged to the in-house guest's folio.
      const o3 = await createPosOrder(tx, actor, { outletId: main.id, kind: "ROOM_SERVICE", reservationId: inHouse.id, covers: 1 });
      await addOrderItem(tx, actor, { orderId: o3.id, menuItemId: mi.get("Caesar salad")!, quantity: 1 });
      await addOrderItem(tx, actor, { orderId: o3.id, menuItemId: mi.get("Cappuccino")!, quantity: 2 });
      await settleOrder(tx, actor, { orderId: o3.id, to: "ROOM", today });
      // Laundry delivered to the room; airport transfer requested.
      const items = new Map((await tx.serviceItem.findMany({ where: { propertyId } })).map((s) => [s.name, s.id]));
      const so = await createServiceOrder(tx, actor, { serviceItemId: items.get("Shirt — wash & press")!, quantity: 3, reservationId: inHouse.id, chargeTo: "ROOM" });
      await deliverServiceOrder(tx, actor, { id: so.id, today });
      await createServiceOrder(tx, actor, { serviceItemId: items.get("Airport transfer (one way)")!, quantity: 1, reservationId: inHouse.id, chargeTo: "ROOM", notes: "Flight EK 612, 06:40" });
      const spa = await createServiceOrder(tx, actor, { serviceItemId: items.get("Swedish massage (60 min)")!, quantity: 1, guestName: "Day visitor", chargeTo: "DIRECT" });
      await deliverServiceOrder(tx, actor, { id: spa.id, method: "CASH", today });
    }
  }, T);

  // ── Suppliers, stock and purchasing
  const sup = async (name: string, contactName: string, phone: string, terms: number) => prisma.supplier.create({ data: { propertyId, name, contactName, phone, paymentTermsDays: terms } });
  const fresh = await sup("Fresh Farm Produce", "Bilal Ahmed", "+92 300 111 2233", 7);
  const linen = await sup("CleanCo Linen & Supplies", "Maria Lopez", "+92 321 555 7788", 30);
  const tech = await sup("Spark Electrical Services", "Imran Raza", "+92 333 444 9900", 15);
  const loc = new Map((await prisma.stockLocation.findMany({ where: { propertyId } })).map((l) => [l.code, l.id]));
  const stock: [string, string, string, string, number, number, number, string][] = [
    // sku, name, category, unit, reorder, opening qty, unit cost, location
    ["HK-TWL", "Bath towel", "HOUSEKEEPING", "pcs", 40, 120, 6.5, "HK"],
    ["HK-SHT", "Bed sheet (king)", "HOUSEKEEPING", "pcs", 30, 80, 12, "HK"],
    ["AM-SHM", "Shampoo 30 ml", "AMENITIES", "pcs", 200, 600, 0.35, "HK"],
    ["AM-SOP", "Soap bar 40 g", "AMENITIES", "pcs", 200, 150, 0.25, "HK"],
    ["AM-WTR", "Water bottle 500 ml", "BEVERAGE", "pcs", 150, 480, 0.3, "MAIN"],
    ["FD-RCE", "Basmati rice", "FOOD", "kg", 25, 60, 2.2, "KIT"],
    ["FD-OIL", "Cooking oil", "FOOD", "L", 20, 40, 3.1, "KIT"],
    ["FD-CHK", "Chicken (fresh)", "FOOD", "kg", 15, 12, 4.8, "KIT"],
    ["MT-LED", "LED bulb 9 W", "MAINTENANCE", "pcs", 20, 45, 1.8, "ENG"],
    ["OF-PPR", "A4 paper (ream)", "OFFICE", "ream", 5, 12, 4.5, "MAIN"],
  ];
  const item = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    for (const [sku, name, category, unit, reorder, qty, cost, l] of stock) {
      const it = await tx.inventoryItem.create({ data: { propertyId, sku, name, category, unit, reorderLevel: reorder, expenseAccount: INVENTORY_CATEGORIES[category].account } });
      item.set(sku, it.id);
      await receiveStock(tx, actor, { itemId: it.id, locationId: loc.get(l)!, quantity: qty, unitCost: cost, date: addDays(today, -20), creditAccount: "3000", reason: "Opening stock" });
    }
    // Daily usage
    await issueStock(tx, actor, { itemId: item.get("AM-SHM")!, locationId: loc.get("HK")!, quantity: 60, date: addDays(today, -2), department: "Housekeeping", reason: "Room amenities" });
    await issueStock(tx, actor, { itemId: item.get("FD-CHK")!, locationId: loc.get("KIT")!, quantity: 4, date: addDays(today, -1), department: "Kitchen" });
    await issueStock(tx, actor, { itemId: item.get("MT-LED")!, locationId: loc.get("ENG")!, quantity: 6, date: addDays(today, -1), department: "Engineering", reason: "Corridor lights" });
    // Purchasing: a received order (bill partly paid), a draft order and a pending request.
    const po = await createPurchaseOrder(tx, actor, { supplierId: linen.id, locationId: loc.get("HK")!, orderDate: addDays(today, -6), expectedDate: addDays(today, -3), lines: [{ itemId: item.get("AM-SOP")!, quantity: 300, unitCost: 0.24 }, { itemId: item.get("HK-TWL")!, quantity: 40, unitCost: 6.2 }] });
    await setPurchaseOrderStatus(tx, actor, po.id, "APPROVED");
    const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id } });
    await receiveGoods(tx, actor, { orderId: po.id, date: addDays(today, -3), supplierRef: "CC-INV-4471", lines: lines.map((l) => ({ poLineId: l.id, quantity: Number(l.quantity) })) });
    const bill = await tx.supplierBill.findFirstOrThrow({ where: { supplierId: linen.id } });
    await paySupplierBill(tx, actor, { billId: bill.id, amount: 100, method: "BANK_TRANSFER", date: addDays(today, -1), reference: "TRF-88120" });
    await createPurchaseOrder(tx, actor, { supplierId: fresh.id, locationId: loc.get("KIT")!, orderDate: today, expectedDate: addDays(today, 1), lines: [{ itemId: item.get("FD-CHK")!, quantity: 20, unitCost: 4.9 }, { itemId: item.get("FD-RCE")!, quantity: 50, unitCost: 2.15 }], notes: "Deliver before 9 am" });
    await createPurchaseRequest(tx, actor, { itemId: item.get("OF-PPR")!, quantity: 10, department: "Administration", reason: "Running low" });
  }, T);

  // ── Maintenance
  await prisma.$transaction(async (tx) => {
    const rooms = await tx.room.findMany({ where: { propertyId }, orderBy: { number: "asc" }, take: 6 });
    const r1 = await createMaintenanceRequest(tx, actor, { roomId: rooms[2].id, category: "HVAC", title: "AC not cooling", description: "Guest reported warm air at night", priority: "HIGH", today, dueAt: addDays(today, 1) });
    if (maint) await assignMaintenance(tx, actor, r1.id, maint);
    await createMaintenanceRequest(tx, actor, { roomId: null, category: "PLUMBING", title: "Leaking tap in lobby washroom", priority: "NORMAL", today });
    const r3 = await createMaintenanceRequest(tx, actor, { roomId: rooms[4].id, category: "ELECTRICAL", title: "Bedside lamp not working", priority: "LOW", today });
    await resolveMaintenance(tx, actor, { id: r3.id, resolution: "Replaced switch and bulb", cost: 45, paidBy: "ON_ACCOUNT", supplierId: tech.id, today });
    await tx.maintenanceSchedule.create({ data: { propertyId, title: "Replace AC filters (all rooms)", category: "HVAC", everyDays: 90, nextDue: addDays(today, 12), priority: "NORMAL" } });
    await tx.maintenanceSchedule.create({ data: { propertyId, title: "Fire extinguisher inspection", category: "SAFETY", everyDays: 180, nextDue: today, priority: "HIGH", equipment: "All floors" } });
    await tx.lostFoundItem.create({ data: { propertyId, description: "Black leather wallet", location: "Lobby sofa", foundBy: "Night security" } });
  }, T);

  // ── Accounting: expenses and a budget
  await prisma.$transaction(async (tx) => {
    await recordExpense(tx, actor, { date: addDays(today, -5), account: "5100", description: "Electricity bill", amount: 840, paidBy: "BANK_TRANSFER", reference: "ELEC-0925" });
    await recordExpense(tx, actor, { date: addDays(today, -4), account: "5600", description: "Fibre internet (monthly)", amount: 120, paidBy: "ON_ACCOUNT", supplierId: tech.id, reference: "NET-311" });
    await recordExpense(tx, actor, { date: addDays(today, -2), account: "5800", description: "Printer toner", amount: 65, paidBy: "CASH" });
    const year = today.getUTCFullYear();
    for (const [account, amount] of [["4000", 420000], ["4100", 90000], ["5000", 180000], ["5200", 36000], ["5400", 12000]] as const) await setBudget(tx, actor, { year, account, amount });
  }, T);

  // ── CRM: loyalty, coupons, feedback, campaign, competitor rates
  await prisma.$transaction(async (tx) => {
    const guests = await tx.guest.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" }, take: 3 });
    for (const [i, g] of guests.entries()) {
      await enrollLoyalty(tx, actor, g.id);
      await adjustPoints(tx, actor, { guestId: g.id, points: [500, 1800, 250][i] ?? 100, note: "Welcome bonus" });
      await tx.guest.update({ where: { id: g.id }, data: { marketingConsent: true } });
    }
    await tx.coupon.create({ data: { propertyId, code: "WELCOME10", description: "10% off for first-time online guests", percentOff: 10 } });
    await tx.coupon.create({ data: { propertyId, code: "STAY3SAVE50", description: "50 off stays of 3+ nights", amountOff: 50, minNights: 3, validTo: addDays(today, 60), maxUses: 100 } });
    await logFeedback(tx, actor, { guestId: guests[0]?.id, kind: "FEEDBACK", category: "STAFF", rating: 5, comments: "Reception team was wonderful and upgraded our view." });
    await logFeedback(tx, actor, { guestId: guests[1]?.id, kind: "FEEDBACK", category: "FOOD", rating: 4, comments: "Great breakfast; coffee could be hotter." });
    await logFeedback(tx, actor, { guestId: guests[2]?.id, kind: "COMPLAINT", category: "NOISE", rating: 2, comments: "Loud music from the bar until 1 am." });
    await tx.campaign.create({ data: { propertyId, name: "Winter weekend getaway", channel: "EMAIL", segment: "LOYALTY", subject: "Your winter escape awaits", body: "Members save 15% on weekend stays this December. Use code WELCOME10 when you book online.", couponCode: "WELCOME10", createdById: userId } });
    for (let i = 0; i < 7; i++) {
      await tx.competitorRate.create({ data: { propertyId, competitor: "Pearl Continental", date: addDays(today, i), roomLabel: "Deluxe King", price: 165 + (i % 3) * 10 } });
      await tx.competitorRate.create({ data: { propertyId, competitor: "Avari Hotel", date: addDays(today, i), roomLabel: "Deluxe King", price: 150 + (i % 2) * 15 } });
    }
    const conn = await saveChannel(tx, actor, { channel: "BOOKING_COM", hotelCode: "1234567", isEnabled: true });
    const types = await tx.roomType.findMany({ where: { propertyId } });
    for (const t of types) await saveChannelMapping(tx, actor, { connectionId: conn.id, roomTypeId: t.id, channelRoomCode: `${t.code}-BDC`, ratePlanCode: "STD", markupPercent: 12 });
  }, T);

  // ── Events
  const ball = await prisma.eventVenue.create({ data: { propertyId, name: "Grand Ballroom", capacity: 300, hourlyRate: 150 } });
  await prisma.eventVenue.create({ data: { propertyId, name: "Boardroom", capacity: 16, hourlyRate: 40 } });
  const garden = await prisma.eventVenue.create({ data: { propertyId, name: "Garden Terrace", capacity: 120, hourlyRate: 90 } });
  await prisma.$transaction(async (tx) => {
    const conf = await createEvent(tx, actor, { venueId: ball.id, title: "Annual Pharma Sales Conference", eventType: "CONFERENCE", clientName: "Ayesha Siddiqui", company: "MediCore Ltd", email: "events@medicore.example", phone: "+92 42 555 0100", date: addDays(today, 8), startMinute: 9 * 60, endMinute: 17 * 60, attendees: 150, confirmed: true, today });
    await addEventItem(tx, actor, { eventId: conf.id, description: "Lunch buffet", quantity: 150, unitPrice: 18, revenueAccount: "4400" });
    await addEventItem(tx, actor, { eventId: conf.id, description: "Tea & coffee breaks (2)", quantity: 300, unitPrice: 4, revenueAccount: "4400" });
    await addEventItem(tx, actor, { eventId: conf.id, description: "Projector & sound system", quantity: 1, unitPrice: 250, revenueAccount: "4300" });
    await eventDeposit(tx, actor, { eventId: conf.id, amount: 2000, method: "BANK_TRANSFER", reference: "MED-ADV-01", idempotencyKey: "demo-evt-dep-1", today });
    await createEvent(tx, actor, { venueId: garden.id, title: "Khan–Malik wedding reception", eventType: "WEDDING", clientName: "Omar Khan", phone: "+92 300 555 0123", date: addDays(today, 21), startMinute: 19 * 60, endMinute: 23 * 60, attendees: 110, confirmed: false, today, notes: "Floral décor quote pending" });
  }, T);
}
