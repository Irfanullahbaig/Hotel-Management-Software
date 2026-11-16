"use server";

import { z } from "zod";
import { formObject, mutate, zs, zx } from "./util";
import { addOrderItem, createPosOrder, setKitchenStatus, setOrderDiscount, settleOrder, voidOrder, voidOrderItem } from "@/server/services/pos";
import type { ActionState } from "./types";

type A = Promise<ActionState>;

// ─── Setup ───

export async function saveOutletAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, code: zs.req("Code"), name: zs.req("Name"), kind: z.enum(["RESTAURANT", "BAR", "CAFE", "ROOM_SERVICE"]), isActive: zs.bool }).parse(formObject(fd));
    const data = { code: d.code.toUpperCase(), name: d.name, kind: d.kind, revenueAccount: "4100" };
    if (d.id) {
      await tx.outlet.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } });
      await tx.outlet.update({ where: { id: d.id }, data: { ...data, isActive: d.isActive } });
    } else await tx.outlet.create({ data: { ...data, propertyId: ctx.property.id } });
    return { ok: true, message: "Outlet saved." };
  });
}

export async function addTablesAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ outletId: zs.req("Outlet"), prefix: zs.req("Prefix"), from: zs.int(1, 999), to: zs.int(1, 999), seats: zs.int(1, 40) }).parse(formObject(fd));
    await tx.outlet.findFirstOrThrow({ where: { id: d.outletId, propertyId: ctx.property.id } });
    if (d.to < d.from) return { ok: false, error: "“To” must be at least “From”." };
    let n = 0;
    for (let i = d.from; i <= d.to; i++) {
      const name = `${d.prefix}${i}`;
      const r = await tx.diningTable.upsert({ where: { outletId_name: { outletId: d.outletId, name } }, update: { seats: d.seats, isActive: true }, create: { outletId: d.outletId, name, seats: d.seats } });
      if (r) n++;
    }
    return { ok: true, message: `${n} table(s) saved.` };
  });
}

export async function saveMenuCategoryAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ name: zs.req("Name"), sortOrder: zs.int(0, 999) }).parse(formObject(fd));
    await tx.menuCategory.create({ data: { ...d, propertyId: ctx.property.id } });
    return { ok: true, message: "Category added." };
  });
}

export async function saveMenuItemAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, categoryId: zs.req("Category"), name: zs.req("Name"), description: zs.str, price: zs.money, station: z.enum(["KITCHEN", "BAR"]), isAvailable: zs.bool }).parse(formObject(fd));
    await tx.menuCategory.findFirstOrThrow({ where: { id: d.categoryId, propertyId: ctx.property.id } });
    const { id, ...data } = d;
    if (id) {
      await tx.menuItem.findFirstOrThrow({ where: { id, category: { propertyId: ctx.property.id } } });
      await tx.menuItem.update({ where: { id }, data: { ...data, description: data.description ?? null } });
    } else await tx.menuItem.create({ data: { ...data, description: data.description ?? null, isAvailable: true } });
    return { ok: true, message: "Menu item saved." };
  });
}

export async function toggleMenuItemAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Item") }).parse(formObject(fd));
    const m = await tx.menuItem.findFirstOrThrow({ where: { id: d.id, category: { propertyId: ctx.property.id } } });
    await tx.menuItem.update({ where: { id: m.id }, data: { isAvailable: !m.isAvailable } });
    return { ok: true, message: m.isAvailable ? `${m.name} marked unavailable.` : `${m.name} is available again.` };
  });
}

// ─── Orders ───

export async function openOrderAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.create", async (tx, ctx) => {
    const d = z.object({
      outletId: zs.req("Outlet"), kind: z.enum(["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"]), tableId: zs.str, reservationId: zs.str, guestName: zs.str, covers: zs.int(1, 100),
    }).parse(formObject(fd));
    const o = await createPosOrder(tx, ctx.actor, d);
    return { ok: true, message: `${o.number} opened.`, redirectTo: `/restaurant/orders/${o.id}` };
  });
}

export async function addOrderItemAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.create", async (tx, ctx) => {
    const d = z.object({ orderId: zs.req("Order"), menuItemId: zs.req("Item"), quantity: zs.int(1, 100), notes: zs.str }).parse(formObject(fd));
    await addOrderItem(tx, ctx.actor, d);
    return { ok: true, message: "Added." };
  });
}

export async function voidOrderItemAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ itemId: zs.req("Item"), reason: zs.req("Reason") }).parse(formObject(fd));
    await voidOrderItem(tx, ctx.actor, d.itemId, d.reason);
    return { ok: true, message: "Item voided." };
  });
}

export async function orderDiscountAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ orderId: zs.req("Order"), amount: zs.money }).parse(formObject(fd));
    await setOrderDiscount(tx, ctx.actor, d.orderId, d.amount);
    return { ok: true, message: "Discount applied." };
  });
}

export async function settleOrderAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.create", async (tx, ctx) => {
    const d = z.object({ orderId: zs.req("Order"), to: z.enum(["ROOM", "PAYMENT"]), method: zx.optMethod, reservationId: zs.str }).parse(formObject(fd));
    await settleOrder(tx, ctx.actor, { ...d, method: d.method ?? null, reservationId: d.reservationId ?? null, today: ctx.today });
    return { ok: true, message: d.to === "ROOM" ? "Charged to the room." : "Paid and closed.", redirectTo: "/restaurant" };
  });
}

export async function voidOrderAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ orderId: zs.req("Order"), reason: zs.req("Reason") }).parse(formObject(fd));
    await voidOrder(tx, ctx.actor, d.orderId, d.reason);
    return { ok: true, message: "Order voided.", redirectTo: "/restaurant" };
  });
}

export async function kitchenStatusAction(_: ActionState, fd: FormData): A {
  return mutate("restaurant.edit", async (tx, ctx) => {
    const d = z.object({ itemId: zs.req("Item"), status: z.enum(["NEW", "PREPARING", "READY", "SERVED"]) }).parse(formObject(fd));
    await setKitchenStatus(tx, ctx.actor, d.itemId, d.status);
    return { ok: true, message: "Updated." };
  });
}
