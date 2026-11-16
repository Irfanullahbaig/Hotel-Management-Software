import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2 } from "@/lib/money";
import { ACC, postJournal } from "./ledger";
import { assert, audit, lockProperty, nextNumber, notify, pad, type Actor } from "./common";

export const INVENTORY_CATEGORIES: Record<string, { label: string; account: string }> = {
  FOOD: { label: "Food", account: "5200" },
  BEVERAGE: { label: "Beverage", account: "5200" },
  HOUSEKEEPING: { label: "Housekeeping supplies", account: "5300" },
  AMENITIES: { label: "Guest amenities", account: "5300" },
  MAINTENANCE: { label: "Maintenance spares", account: "5400" },
  OFFICE: { label: "Office & stationery", account: "5800" },
  OTHER: { label: "Other", account: "5900" },
};

export const DEFAULT_LOCATIONS = [["MAIN", "Main store"], ["KIT", "Kitchen"], ["BAR", "Bar"], ["HK", "Housekeeping store"], ["ENG", "Engineering store"]] as const;

export async function ensureInventoryDefaults(tx: Tx, propertyId: string) {
  for (const [code, name] of DEFAULT_LOCATIONS) {
    await tx.stockLocation.upsert({ where: { propertyId_code: { propertyId, code } }, update: {}, create: { propertyId, code, name } });
  }
}

const lockItem = (tx: Tx, actor: Actor, itemId: string) => lockProperty(tx, actor.propertyId, `stock:${itemId}`);

async function loadItem(tx: Tx, actor: Actor, itemId: string) {
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, propertyId: actor.propertyId }, include: { levels: true } });
  assert(item, "Item not found.");
  return item;
}

async function loadLocation(tx: Tx, actor: Actor, locationId: string) {
  const l = await tx.stockLocation.findFirst({ where: { id: locationId, propertyId: actor.propertyId } });
  assert(l, "Location not found.");
  return l;
}

async function changeLevel(tx: Tx, itemId: string, locationId: string, delta: Prisma.Decimal) {
  const current = await tx.stockLevel.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
  const next = D(current?.quantity).plus(delta);
  assert(!next.isNegative(), `Not enough stock: only ${D(current?.quantity).toString()} on hand at that location.`);
  await tx.stockLevel.upsert({ where: { itemId_locationId: { itemId, locationId } }, update: { quantity: next }, create: { itemId, locationId, quantity: next } });
}

const onHand = (item: { levels: { quantity: Prisma.Decimal }[] }) => item.levels.reduce((a, l) => a.plus(l.quantity), ZERO);

async function txnNumber(tx: Tx, propertyId: string) {
  return `STK-${pad(await nextNumber(tx, propertyId, "STK"), 6)}`;
}

/**
 * Stock in at a cost; the item's weighted-average cost is updated.
 * When `creditAccount` is given, posts Dr 1200 Inventory / Cr that account (cash, bank, opening equity).
 * Receipts against a purchase order leave the posting to the supplier bill.
 */
export async function receiveStock(
  tx: Tx,
  actor: Actor,
  input: { itemId: string; locationId: string; quantity: Prisma.Decimal.Value; unitCost: Prisma.Decimal.Value; date: Date; creditAccount?: string | null; reason?: string | null; sourceType?: string; sourceId?: string },
) {
  await lockItem(tx, actor, input.itemId);
  const item = await loadItem(tx, actor, input.itemId);
  await loadLocation(tx, actor, input.locationId);
  const qty = D(input.quantity);
  const cost = D(input.unitCost);
  assert(qty.greaterThan(0), "Quantity must be greater than zero.");
  assert(!cost.isNegative(), "Unit cost cannot be negative.");
  const have = onHand(item);
  const value = have.times(item.avgCost).plus(qty.times(cost));
  const avg = have.plus(qty).isZero() ? cost : value.dividedBy(have.plus(qty)).toDecimalPlaces(4);
  await changeLevel(tx, item.id, input.locationId, qty);
  await tx.inventoryItem.update({ where: { id: item.id }, data: { avgCost: avg } });
  const total = round2(qty.times(cost));
  const t = await tx.inventoryTxn.create({
    data: {
      propertyId: actor.propertyId, number: await txnNumber(tx, actor.propertyId), type: "RECEIPT", itemId: item.id, toLocationId: input.locationId,
      quantity: qty, unitCost: cost, totalCost: total, date: input.date, account: input.creditAccount ?? null, reason: input.reason ?? null,
      sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, createdById: actor.userId,
    },
  });
  if (input.creditAccount && total.greaterThan(0)) {
    const e = await postJournal(tx, actor, {
      date: input.date, memo: `Stock received: ${item.name} × ${qty}`, sourceType: "STOCK", sourceId: t.id,
      lines: [{ account: ACC.INVENTORY, debit: total }, { account: input.creditAccount, credit: total }],
    });
    await tx.inventoryTxn.update({ where: { id: t.id }, data: { journalEntryId: e.id } });
  }
  return t;
}

/** Stock out to a department at average cost: Dr expense account / Cr 1200 Inventory. */
export async function issueStock(
  tx: Tx,
  actor: Actor,
  input: { itemId: string; locationId: string; quantity: Prisma.Decimal.Value; date: Date; account?: string | null; department?: string | null; reason?: string | null },
) {
  await lockItem(tx, actor, input.itemId);
  const item = await loadItem(tx, actor, input.itemId);
  await loadLocation(tx, actor, input.locationId);
  const qty = D(input.quantity);
  assert(qty.greaterThan(0), "Quantity must be greater than zero.");
  await changeLevel(tx, item.id, input.locationId, qty.negated());
  const total = round2(qty.times(item.avgCost));
  const account = input.account || item.expenseAccount;
  const t = await tx.inventoryTxn.create({
    data: {
      propertyId: actor.propertyId, number: await txnNumber(tx, actor.propertyId), type: "ISSUE", itemId: item.id, fromLocationId: input.locationId,
      quantity: qty, unitCost: item.avgCost, totalCost: total, date: input.date, account, department: input.department ?? null, reason: input.reason ?? null, createdById: actor.userId,
    },
  });
  if (total.greaterThan(0)) {
    const e = await postJournal(tx, actor, {
      date: input.date, memo: `Issued ${item.name} × ${qty}${input.department ? ` to ${input.department}` : ""}`, sourceType: "STOCK", sourceId: t.id,
      lines: [{ account, debit: total }, { account: ACC.INVENTORY, credit: total }],
    });
    await tx.inventoryTxn.update({ where: { id: t.id }, data: { journalEntryId: e.id } });
  }
  await lowStockCheck(tx, actor, item.id);
  return t;
}

/** Move stock between locations. Value is unchanged, so nothing is posted to the ledger. */
export async function transferStock(tx: Tx, actor: Actor, input: { itemId: string; fromLocationId: string; toLocationId: string; quantity: Prisma.Decimal.Value; date: Date; reason?: string | null }) {
  assert(input.fromLocationId !== input.toLocationId, "Choose two different locations.");
  await lockItem(tx, actor, input.itemId);
  const item = await loadItem(tx, actor, input.itemId);
  await loadLocation(tx, actor, input.fromLocationId);
  await loadLocation(tx, actor, input.toLocationId);
  const qty = D(input.quantity);
  assert(qty.greaterThan(0), "Quantity must be greater than zero.");
  await changeLevel(tx, item.id, input.fromLocationId, qty.negated());
  await changeLevel(tx, item.id, input.toLocationId, qty);
  return tx.inventoryTxn.create({
    data: {
      propertyId: actor.propertyId, number: await txnNumber(tx, actor.propertyId), type: "TRANSFER", itemId: item.id, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId,
      quantity: qty, unitCost: item.avgCost, totalCost: round2(qty.times(item.avgCost)), date: input.date, reason: input.reason ?? null, createdById: actor.userId,
    },
  });
}

/** Physical count: the difference is valued at average cost and posted to 5900 (shrinkage / gain). */
export async function adjustStock(tx: Tx, actor: Actor, input: { itemId: string; locationId: string; countedQty: Prisma.Decimal.Value; date: Date; reason: string }) {
  await lockItem(tx, actor, input.itemId);
  const item = await loadItem(tx, actor, input.itemId);
  await loadLocation(tx, actor, input.locationId);
  const counted = D(input.countedQty);
  assert(!counted.isNegative(), "The counted quantity cannot be negative.");
  const current = D(item.levels.find((l) => l.locationId === input.locationId)?.quantity);
  const diff = counted.minus(current);
  assert(!diff.isZero(), "The count matches the system quantity; nothing to adjust.");
  await changeLevel(tx, item.id, input.locationId, diff);
  const total = round2(diff.abs().times(item.avgCost));
  const gain = diff.greaterThan(0);
  const t = await tx.inventoryTxn.create({
    data: {
      propertyId: actor.propertyId, number: await txnNumber(tx, actor.propertyId), type: "ADJUSTMENT", itemId: item.id,
      fromLocationId: gain ? null : input.locationId, toLocationId: gain ? input.locationId : null,
      quantity: diff.abs(), unitCost: item.avgCost, totalCost: total, date: input.date, account: "5900", reason: `${gain ? "Count gain" : "Count loss"}: ${input.reason}`, createdById: actor.userId,
    },
  });
  if (total.greaterThan(0)) {
    const e = await postJournal(tx, actor, {
      date: input.date, memo: `Stock count ${gain ? "gain" : "loss"}: ${item.name} ${diff.toString()}`, sourceType: "STOCK", sourceId: t.id,
      lines: gain ? [{ account: ACC.INVENTORY, debit: total }, { account: "5900", credit: total }] : [{ account: "5900", debit: total }, { account: ACC.INVENTORY, credit: total }],
    });
    await tx.inventoryTxn.update({ where: { id: t.id }, data: { journalEntryId: e.id } });
  }
  await audit(tx, actor, "inventory.adjust", "InventoryItem", item.id, `${item.name}: ${current} → ${counted} (${input.reason})`);
  if (!gain) await lowStockCheck(tx, actor, item.id);
  return t;
}

async function lowStockCheck(tx: Tx, actor: Actor, itemId: string) {
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, include: { levels: true } });
  if (D(item.reorderLevel).greaterThan(0) && onHand(item).lessThanOrEqualTo(item.reorderLevel)) {
    await notify(tx, actor.propertyId, { type: "LOW_STOCK", title: `Low stock: ${item.name}`, body: `${onHand(item).toString()} ${item.unit} left (reorder at ${item.reorderLevel})`, link: "/inventory?tab=low" });
  }
}

export const stockOnHand = onHand;
