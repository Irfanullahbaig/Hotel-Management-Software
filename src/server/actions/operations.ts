"use server";

import { z } from "zod";
import { formObject, mutate, zs, zx } from "./util";
import { audit } from "@/server/services/common";
import {
  SERVICE_CATEGORIES, assignMaintenance, cancelMaintenance, createMaintenanceRequest, createServiceOrder, deliverServiceOrder,
  generateDueMaintenance, resolveMaintenance, setServiceOrderStatus, startMaintenance,
} from "@/server/services/operations";
import type { ActionState } from "./types";

type A = Promise<ActionState>;
const id = z.object({ id: zs.req("Record") });

// ─── Maintenance ───

export async function createMaintenanceAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.create", async (tx, ctx) => {
    const d = z.object({
      roomId: zs.str, category: zs.req("Category"), title: zs.req("Title"), description: zs.text, priority: zx.priority,
      dueAt: zx.optDate, blockUntil: zx.optDate, assigneeId: zs.str,
    }).parse(formObject(fd));
    const r = await createMaintenanceRequest(tx, ctx.actor, { ...d, roomId: d.roomId ?? null, today: ctx.today });
    if (d.assigneeId) await assignMaintenance(tx, ctx.actor, r.id, d.assigneeId);
    return { ok: true, message: `${r.number} logged.` };
  });
}

export async function assignMaintenanceAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Request"), assigneeId: zs.str }).parse(formObject(fd));
    await assignMaintenance(tx, ctx.actor, d.id, d.assigneeId ?? null);
    return { ok: true, message: "Assigned." };
  });
}

export async function startMaintenanceAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.edit", async (tx, ctx) => {
    await startMaintenance(tx, ctx.actor, id.parse(formObject(fd)).id);
    return { ok: true, message: "Work started." };
  });
}

export async function resolveMaintenanceAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.edit", async (tx, ctx) => {
    const d = z.object({
      id: zs.req("Request"), resolution: zs.req("What was done"), cost: zs.money,
      paidBy: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["CASH", "BANK_TRANSFER", "ON_ACCOUNT"]).optional()), supplierId: zs.str,
    }).parse(formObject(fd));
    await resolveMaintenance(tx, ctx.actor, { ...d, paidBy: d.paidBy ?? null, supplierId: d.supplierId ?? null, today: ctx.today });
    return { ok: true, message: "Marked complete." };
  });
}

export async function cancelMaintenanceAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.edit", async (tx, ctx) => {
    await cancelMaintenance(tx, ctx.actor, id.parse(formObject(fd)).id, ctx.today);
    return { ok: true, message: "Cancelled." };
  });
}

export async function saveScheduleAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.create", async (tx, ctx) => {
    const d = z.object({
      id: zs.str, title: zs.req("Title"), category: zs.req("Category"), roomId: zs.str, equipment: zs.str,
      everyDays: zs.int(1, 3650), nextDue: zs.date, priority: zx.priority, isActive: zs.bool,
    }).parse(formObject(fd));
    const { id: sid, ...data } = d;
    const row = { ...data, roomId: data.roomId ?? null, equipment: data.equipment ?? null };
    if (sid) {
      await tx.maintenanceSchedule.findFirstOrThrow({ where: { id: sid, propertyId: ctx.property.id } });
      await tx.maintenanceSchedule.update({ where: { id: sid }, data: row });
    } else {
      await tx.maintenanceSchedule.create({ data: { ...row, isActive: true, propertyId: ctx.property.id } });
    }
    return { ok: true, message: "Schedule saved." };
  });
}

export async function runSchedulesAction(_: ActionState, _fd: FormData): A {
  return mutate("maintenance.create", async (tx, ctx) => {
    const n = await generateDueMaintenance(tx, ctx.actor, ctx.today);
    return { ok: true, message: n ? `${n} preventive job(s) created.` : "Nothing is due." };
  });
}

// ─── Lost & found ───

export async function logLostItemAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.create", async (tx, ctx) => {
    const d = z.object({ description: zs.req("Description"), location: zs.req("Where found"), roomId: zs.str, foundBy: zs.str, notes: zs.text }).parse(formObject(fd));
    const item = await tx.lostFoundItem.create({ data: { ...d, roomId: d.roomId ?? null, foundBy: d.foundBy ?? null, notes: d.notes ?? null, propertyId: ctx.property.id } });
    await audit(tx, ctx.actor, "lostfound.log", "LostFoundItem", item.id, `Found: ${d.description}`);
    return { ok: true, message: "Item logged." };
  });
}

export async function closeLostItemAction(_: ActionState, fd: FormData): A {
  return mutate("maintenance.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Item"), status: z.enum(["RETURNED", "DISPOSED"]), returnedTo: zs.str, notes: zs.text }).parse(formObject(fd));
    const item = await tx.lostFoundItem.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id, status: "STORED" } });
    if (d.status === "RETURNED" && !d.returnedTo) return { ok: false, error: "Enter who collected the item." };
    await tx.lostFoundItem.update({ where: { id: item.id }, data: { status: d.status, returnedTo: d.returnedTo ?? null, closedAt: new Date(), notes: [item.notes, d.notes].filter(Boolean).join("\n") || null } });
    await audit(tx, ctx.actor, `lostfound.${d.status.toLowerCase()}`, "LostFoundItem", item.id, `${item.description} ${d.status.toLowerCase()}${d.returnedTo ? ` to ${d.returnedTo}` : ""}`);
    return { ok: true, message: "Updated." };
  });
}

// ─── Services ───

export async function saveServiceItemAction(_: ActionState, fd: FormData): A {
  return mutate(fd.get("id") ? "services.edit" : "services.create", async (tx, ctx) => {
    const d = z.object({ id: zs.str, category: z.enum(Object.keys(SERVICE_CATEGORIES) as [string, ...string[]]), name: zs.req("Name"), price: zs.money, isActive: zs.bool }).parse(formObject(fd));
    const data = { category: d.category, name: d.name, price: d.price, revenueAccount: SERVICE_CATEGORIES[d.category].account };
    if (d.id) {
      await tx.serviceItem.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } });
      await tx.serviceItem.update({ where: { id: d.id }, data: { ...data, isActive: d.isActive } });
    } else await tx.serviceItem.create({ data: { ...data, propertyId: ctx.property.id } });
    return { ok: true, message: "Service saved." };
  });
}

export async function createServiceOrderAction(_: ActionState, fd: FormData): A {
  return mutate("services.create", async (tx, ctx) => {
    const d = z.object({
      serviceItemId: zs.req("Service"), quantity: zs.int(1, 1000), reservationId: zs.str, guestName: zs.str,
      chargeTo: z.enum(["ROOM", "DIRECT"]), scheduledFor: zs.str, notes: zs.text,
    }).parse(formObject(fd));
    const o = await createServiceOrder(tx, ctx.actor, { ...d, scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null });
    return { ok: true, message: `${o.number} created.` };
  });
}

export async function serviceOrderStatusAction(_: ActionState, fd: FormData): A {
  return mutate("services.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Order"), status: z.enum(["IN_PROGRESS", "CANCELLED"]) }).parse(formObject(fd));
    await setServiceOrderStatus(tx, ctx.actor, d.id, d.status);
    return { ok: true, message: "Updated." };
  });
}

export async function deliverServiceOrderAction(_: ActionState, fd: FormData): A {
  return mutate("services.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Order"), method: zx.optMethod }).parse(formObject(fd));
    await deliverServiceOrder(tx, ctx.actor, { id: d.id, method: d.method ?? null, today: ctx.today });
    return { ok: true, message: "Delivered and billed." };
  });
}
