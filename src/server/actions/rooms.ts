"use server";

import { z } from "zod";
import { mutate, formObject, zs } from "./util";
import { blockRoom, changeHousekeepingStatus, releaseRoom } from "@/server/services/rooms";
import { audit, BusinessError } from "@/server/services/common";
import type { ActionState } from "./types";

const roomTypeSchema = z.object({
  id: zs.str,
  code: zs.req("Code").transform((s) => s.toUpperCase()),
  name: zs.req("Name"),
  description: zs.text,
  baseOccupancy: zs.int(1, 20),
  maxOccupancy: zs.int(1, 20),
  maxAdults: zs.int(1, 20),
  maxChildren: zs.int(0, 20),
  bedConfiguration: zs.str,
  sizeSqm: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(10000).optional()),
  basePrice: zs.money.refine((v) => v > 0, "Base price must be greater than zero"),
  extraAdultCharge: zs.money,
  extraChildCharge: zs.money,
  isActive: zs.bool,
});

export async function saveRoomTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(["rooms.edit"], async (tx, ctx) => {
    const d = roomTypeSchema.parse(formObject(fd));
    if (d.maxOccupancy < d.baseOccupancy) throw new BusinessError("Maximum occupancy cannot be lower than base occupancy.");
    if (d.maxAdults > d.maxOccupancy) throw new BusinessError("Maximum adults cannot exceed maximum occupancy.");
    const amenityIds = fd.getAll("amenities").map(String);
    const { id, ...data } = d;
    const rt = id
      ? await tx.roomType.update({ where: { id, propertyId: ctx.property.id }, data })
      : await tx.roomType.create({ data: { ...data, propertyId: ctx.property.id } });
    await tx.roomTypeAmenity.deleteMany({ where: { roomTypeId: rt.id } });
    const valid = await tx.amenity.findMany({ where: { id: { in: amenityIds }, propertyId: ctx.property.id } });
    if (valid.length) await tx.roomTypeAmenity.createMany({ data: valid.map((a) => ({ roomTypeId: rt.id, amenityId: a.id })) });
    await audit(tx, ctx.actor, id ? "roomtype.update" : "roomtype.create", "RoomType", rt.id, `${id ? "Updated" : "Created"} room type ${rt.name}`, { after: data });
    return { ok: true, message: `Room type ${rt.name} saved.` };
  });
}

const rateSchema = z.object({
  roomTypeId: zs.req("Room type"),
  name: zs.req("Rate name"),
  kind: z.enum(["SEASONAL", "WEEKEND", "HOLIDAY", "PROMOTIONAL"]),
  startDate: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()),
  endDate: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()),
  price: zs.money.refine((v) => v > 0, "Price must be greater than zero"),
  priority: zs.int(0, 1000),
});

export async function addRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.edit", async (tx, ctx) => {
    const d = rateSchema.parse(formObject(fd));
    const days = fd.getAll("daysOfWeek").map(Number).filter((n) => n >= 0 && n <= 6);
    if (d.startDate && d.endDate && d.endDate < d.startDate) throw new BusinessError("End date must be on or after the start date.");
    if (d.kind !== "WEEKEND" && !d.startDate && days.length === 0) throw new BusinessError("Give a date range or days of the week for this rate.");
    await tx.roomType.findFirstOrThrow({ where: { id: d.roomTypeId, propertyId: ctx.property.id } });
    const rate = await tx.roomRate.create({ data: { ...d, daysOfWeek: days } });
    await audit(tx, ctx.actor, "rate.create", "RoomRate", rate.id, `Added rate ${d.name} (${d.price})`);
    return { ok: true, message: "Rate added. New bookings will use it; existing bookings keep their rates." };
  });
}

export async function toggleRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.edit", async (tx, ctx) => {
    const id = String(fd.get("id"));
    const rate = await tx.roomRate.findFirstOrThrow({ where: { id, roomType: { propertyId: ctx.property.id } } });
    await tx.roomRate.update({ where: { id }, data: { isActive: !rate.isActive } });
    await audit(tx, ctx.actor, "rate.toggle", "RoomRate", id, `${rate.isActive ? "Disabled" : "Enabled"} rate ${rate.name}`);
    return { ok: true, message: rate.isActive ? "Rate disabled." : "Rate enabled." };
  });
}

const roomSchema = z.object({
  id: zs.str,
  number: zs.req("Room number"),
  name: zs.str,
  roomTypeId: zs.req("Room type"),
  floor: zs.int(-5, 200),
  building: zs.str,
  description: zs.text,
  isActive: zs.bool,
});

export async function saveRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(["rooms.edit"], async (tx, ctx) => {
    const d = roomSchema.parse(formObject(fd));
    await tx.roomType.findFirstOrThrow({ where: { id: d.roomTypeId, propertyId: ctx.property.id } });
    const { id, ...data } = d;
    if (id && !data.isActive) {
      const future = await tx.reservationRoom.count({ where: { roomId: id, status: { in: ["RESERVED", "CHECKED_IN"] } } });
      if (future) throw new BusinessError("This room has current or upcoming stays. Move them before deactivating it.");
    }
    const room = id
      ? await tx.room.update({ where: { id, propertyId: ctx.property.id }, data })
      : await tx.room.create({ data: { ...data, propertyId: ctx.property.id } });
    await audit(tx, ctx.actor, id ? "room.update" : "room.create", "Room", room.id, `${id ? "Updated" : "Created"} room ${room.number}`, { after: data });
    return { ok: true, message: `Room ${room.number} saved.`, redirectTo: `/rooms/${room.id}` };
  });
}

export async function bulkCreateRoomsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(["rooms.create"], async (tx, ctx) => {
    const d = z.object({ roomTypeId: zs.req("Room type"), floor: zs.int(-5, 200), from: zs.int(0, 99999), to: zs.int(0, 99999), prefix: zs.str, building: zs.str }).parse(formObject(fd));
    if (d.to < d.from) throw new BusinessError("'To' must be greater than or equal to 'From'.");
    if (d.to - d.from >= 200) throw new BusinessError("Create at most 200 rooms at a time.");
    await tx.roomType.findFirstOrThrow({ where: { id: d.roomTypeId, propertyId: ctx.property.id } });
    const numbers = Array.from({ length: d.to - d.from + 1 }, (_, i) => `${d.prefix ?? ""}${d.from + i}`);
    const clash = await tx.room.findMany({ where: { propertyId: ctx.property.id, number: { in: numbers } } });
    if (clash.length) throw new BusinessError(`These room numbers already exist: ${clash.map((r) => r.number).join(", ")}`);
    await tx.room.createMany({ data: numbers.map((number) => ({ propertyId: ctx.property.id, roomTypeId: d.roomTypeId, floor: d.floor, number, building: d.building })) });
    await audit(tx, ctx.actor, "room.bulk_create", "Room", null, `Created rooms ${numbers[0]}–${numbers.at(-1)}`);
    return { ok: true, message: `Created ${numbers.length} rooms.`, redirectTo: "/rooms" };
  });
}

export async function housekeepingStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.change_status", async (tx, ctx) => {
    const d = z.object({ roomId: zs.req("Room"), status: z.enum(["DIRTY", "CLEANING_ASSIGNED", "CLEANING_IN_PROGRESS", "CLEAN", "INSPECTED"]), note: zs.str }).parse(formObject(fd));
    await changeHousekeepingStatus(tx, ctx.actor, d.roomId, d.status, d.note);
    return { ok: true, message: "Room status updated." };
  });
}

export async function blockRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.change_status", async (tx, ctx) => {
    const d = z.object({ roomId: zs.req("Room"), kind: z.enum(["OUT_OF_SERVICE", "UNDER_MAINTENANCE", "BLOCKED"]), startDate: zs.date, endDate: zs.date, reason: zs.req("Reason") }).parse(formObject(fd));
    await blockRoom(tx, ctx.actor, { ...d, today: ctx.today });
    if (d.kind === "UNDER_MAINTENANCE") {
      await tx.maintenanceRequest.create({ data: { propertyId: ctx.property.id, roomId: d.roomId, category: "Other", title: d.reason, blocksRoom: true, reportedBy: ctx.user.id } });
    }
    return { ok: true, message: "Room taken out of inventory for those dates." };
  });
}

export async function releaseRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.change_status", async (tx, ctx) => {
    await releaseRoom(tx, ctx.actor, String(fd.get("roomId")), ctx.today);
    return { ok: true, message: "Room returned to service. It needs inspection before it can be sold." };
  });
}

export async function addAmenityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("rooms.edit", async (tx, ctx) => {
    const name = zs.req("Amenity").parse(fd.get("name"));
    await tx.amenity.create({ data: { propertyId: ctx.property.id, name } });
    return { ok: true, message: `Amenity "${name}" added.` };
  });
}
