"use server";

import { z } from "zod";
import { formObject, lines, mutate, zs, zx } from "./util";
import { BusinessError } from "@/server/services/common";
import { INVENTORY_CATEGORIES, adjustStock, issueStock, receiveStock, transferStock } from "@/server/services/inventory";
import { createPurchaseOrder, createPurchaseRequest, decidePurchaseRequest, receiveGoods, setPurchaseOrderStatus } from "@/server/services/purchasing";
import type { ActionState } from "./types";

type A = Promise<ActionState>;
const qty = z.coerce.number().positive("Quantity must be greater than zero").max(1_000_000);

// ─── Items & stock ───

export async function saveItemAction(_: ActionState, fd: FormData): A {
  return mutate(fd.get("id") ? "inventory.edit" : "inventory.create", async (tx, ctx) => {
    const d = z.object({
      id: zs.str, sku: zs.req("SKU"), name: zs.req("Name"), category: z.enum(Object.keys(INVENTORY_CATEGORIES) as [string, ...string[]]),
      unit: zs.req("Unit"), reorderLevel: zs.money, isActive: zs.bool,
    }).parse(formObject(fd));
    const data = { sku: d.sku.toUpperCase(), name: d.name, category: d.category, unit: d.unit, reorderLevel: d.reorderLevel, expenseAccount: INVENTORY_CATEGORIES[d.category].account };
    if (d.id) {
      await tx.inventoryItem.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } });
      await tx.inventoryItem.update({ where: { id: d.id }, data: { ...data, isActive: d.isActive } });
    } else await tx.inventoryItem.create({ data: { ...data, propertyId: ctx.property.id } });
    return { ok: true, message: "Item saved." };
  });
}

export async function saveLocationAction(_: ActionState, fd: FormData): A {
  return mutate("inventory.edit", async (tx, ctx) => {
    const d = z.object({ code: zs.req("Code"), name: zs.req("Name") }).parse(formObject(fd));
    await tx.stockLocation.create({ data: { code: d.code.toUpperCase(), name: d.name, propertyId: ctx.property.id } });
    return { ok: true, message: "Location added." };
  });
}

export async function stockMoveAction(_: ActionState, fd: FormData): A {
  const type = String(fd.get("type"));
  return mutate(type === "ADJUST" ? "inventory.approve" : "inventory.create", async (tx, ctx) => {
    const o = formObject(fd);
    switch (type) {
      case "RECEIVE": {
        const d = z.object({ itemId: zs.req("Item"), locationId: zs.req("Location"), quantity: qty, unitCost: zs.money, paidBy: z.enum(["CASH", "BANK_TRANSFER", "OPENING"]), date: zs.date, reason: zs.str }).parse(o);
        const credit = d.paidBy === "CASH" ? "1000" : d.paidBy === "BANK_TRANSFER" ? "1010" : "3000";
        await receiveStock(tx, ctx.actor, { ...d, creditAccount: credit });
        return { ok: true, message: "Stock received." };
      }
      case "ISSUE": {
        const d = z.object({ itemId: zs.req("Item"), locationId: zs.req("Location"), quantity: qty, department: zs.str, date: zs.date, reason: zs.str }).parse(o);
        await issueStock(tx, ctx.actor, d);
        return { ok: true, message: "Stock issued." };
      }
      case "TRANSFER": {
        const d = z.object({ itemId: zs.req("Item"), fromLocationId: zs.req("From"), toLocationId: zs.req("To"), quantity: qty, date: zs.date, reason: zs.str }).parse(o);
        await transferStock(tx, ctx.actor, d);
        return { ok: true, message: "Stock moved." };
      }
      case "ADJUST": {
        const d = z.object({ itemId: zs.req("Item"), locationId: zs.req("Location"), countedQty: zs.money, date: zs.date, reason: zs.req("Reason") }).parse(o);
        await adjustStock(tx, ctx.actor, d);
        return { ok: true, message: "Count recorded." };
      }
    }
    throw new BusinessError("Unknown stock movement.");
  });
}

// ─── Procurement ───

export async function saveSupplierAction(_: ActionState, fd: FormData): A {
  return mutate(fd.get("id") ? "procurement.edit" : "procurement.create", async (tx, ctx) => {
    const d = z.object({
      id: zs.str, name: zs.req("Name"), contactName: zs.str, email: zs.email, phone: zs.str, address: zs.str, taxId: zs.str, paymentTermsDays: zs.int(0, 365), isActive: zs.bool,
    }).parse(formObject(fd));
    const { id, isActive, ...rest } = d;
    const data = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? null])) as typeof rest & { name: string; paymentTermsDays: number };
    if (id) {
      await tx.supplier.findFirstOrThrow({ where: { id, propertyId: ctx.property.id } });
      await tx.supplier.update({ where: { id }, data: { ...data, isActive } as never });
    } else await tx.supplier.create({ data: { ...data, propertyId: ctx.property.id } as never });
    return { ok: true, message: "Supplier saved." };
  });
}

export async function purchaseRequestAction(_: ActionState, fd: FormData): A {
  return mutate("procurement.create", async (tx, ctx) => {
    const d = z.object({ itemId: zs.req("Item"), quantity: qty, reason: zs.str, department: zs.str }).parse(formObject(fd));
    await createPurchaseRequest(tx, ctx.actor, d);
    return { ok: true, message: "Request submitted." };
  });
}

export async function decideRequestAction(_: ActionState, fd: FormData): A {
  return mutate("procurement.approve", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Request"), decision: z.enum(["APPROVE", "REJECT"]) }).parse(formObject(fd));
    await decidePurchaseRequest(tx, ctx.actor, d.id, d.decision === "APPROVE");
    return { ok: true, message: d.decision === "APPROVE" ? "Approved." : "Rejected." };
  });
}

export async function createPoAction(_: ActionState, fd: FormData): A {
  return mutate("procurement.create", async (tx, ctx) => {
    const d = z.object({ supplierId: zs.req("Supplier"), locationId: zs.req("Deliver to"), orderDate: zs.date, expectedDate: zx.optDate, notes: zs.text }).parse(formObject(fd));
    const rows = lines(fd, ["itemId", "quantity", "unitCost"]).filter((r) => r.itemId).map((r) => ({ itemId: r.itemId, quantity: Number(r.quantity), unitCost: Number(r.unitCost || 0) }));
    if (rows.some((r) => !(r.quantity > 0))) throw new BusinessError("Every line needs a quantity.");
    const requestIds = fd.getAll("requestId").map(String).filter(Boolean);
    const po = await createPurchaseOrder(tx, ctx.actor, { ...d, lines: rows, requestIds });
    return { ok: true, message: `${po.number} created.`, redirectTo: `/procurement/orders/${po.id}` };
  });
}

export async function poStatusAction(_: ActionState, fd: FormData): A {
  const to = String(fd.get("to"));
  return mutate(to === "APPROVED" ? "procurement.approve" : "procurement.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Order"), to: z.enum(["SUBMITTED", "APPROVED", "CANCELLED"]) }).parse(formObject(fd));
    await setPurchaseOrderStatus(tx, ctx.actor, d.id, d.to);
    return { ok: true, message: `Order ${d.to.toLowerCase()}.` };
  });
}

export async function receiveGoodsAction(_: ActionState, fd: FormData): A {
  return mutate(["procurement.edit"], async (tx, ctx) => {
    const d = z.object({ orderId: zs.req("Order"), date: zs.date, supplierRef: zs.str, notes: zs.text }).parse(formObject(fd));
    const rows = lines(fd, ["poLineId", "receiveQty", "receiveCost"]).map((r) => ({ poLineId: r.poLineId, quantity: Number(r.receiveQty || 0), unitCost: r.receiveCost === "" ? null : Number(r.receiveCost) }));
    const grn = await receiveGoods(tx, ctx.actor, { ...d, lines: rows });
    return { ok: true, message: `${grn.number} received; the supplier bill is in Payables.` };
  });
}
