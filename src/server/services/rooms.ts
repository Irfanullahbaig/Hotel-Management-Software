import type { HousekeepingStatus, OccupancyStatus, Room, ServiceStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { BusinessError, assert, audit, notify, type Actor } from "./common";

export type DisplayStatus =
  | "AVAILABLE" | "RESERVED" | "OCCUPIED" | "DIRTY" | "CLEANING_ASSIGNED" | "CLEANING_IN_PROGRESS" | "CLEAN"
  | "INSPECTED" | "OUT_OF_SERVICE" | "UNDER_MAINTENANCE" | "BLOCKED";

export function displayStatus(room: Pick<Room, "occupancyStatus" | "housekeepingStatus" | "serviceStatus">, arrivingToday = false): DisplayStatus {
  if (room.serviceStatus !== "IN_SERVICE") return room.serviceStatus;
  if (room.occupancyStatus === "OCCUPIED") return "OCCUPIED";
  if (room.housekeepingStatus !== "INSPECTED" && room.housekeepingStatus !== "CLEAN") return room.housekeepingStatus;
  if (arrivingToday) return "RESERVED";
  return room.housekeepingStatus === "CLEAN" ? "CLEAN" : "AVAILABLE";
}

type Change = { occupancyStatus?: OccupancyStatus; housekeepingStatus?: HousekeepingStatus; serviceStatus?: ServiceStatus };

/** Single entry point for room state changes so every change is logged. */
export async function setRoomStatus(tx: Tx, actor: Actor, roomId: string, change: Change, reason: string) {
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  assert(room.propertyId === actor.propertyId, "Room belongs to another property.");
  const logs: { field: string; fromValue: string; toValue: string }[] = [];
  if (change.occupancyStatus && change.occupancyStatus !== room.occupancyStatus) logs.push({ field: "occupancy", fromValue: room.occupancyStatus, toValue: change.occupancyStatus });
  if (change.housekeepingStatus && change.housekeepingStatus !== room.housekeepingStatus) logs.push({ field: "housekeeping", fromValue: room.housekeepingStatus, toValue: change.housekeepingStatus });
  if (change.serviceStatus && change.serviceStatus !== room.serviceStatus) logs.push({ field: "service", fromValue: room.serviceStatus, toValue: change.serviceStatus });
  if (logs.length === 0) return room;
  const updated = await tx.room.update({ where: { id: roomId }, data: change });
  await tx.roomStatusLog.createMany({ data: logs.map((l) => ({ ...l, roomId, reason, userId: actor.userId })) });
  return updated;
}

const HK_NEXT: Record<HousekeepingStatus, HousekeepingStatus[]> = {
  DIRTY: ["CLEANING_ASSIGNED", "CLEANING_IN_PROGRESS", "CLEAN"],
  CLEANING_ASSIGNED: ["CLEANING_IN_PROGRESS", "CLEAN", "DIRTY"],
  CLEANING_IN_PROGRESS: ["CLEAN", "DIRTY"],
  CLEAN: ["INSPECTED", "DIRTY"],
  INSPECTED: ["DIRTY"],
};

/** Manual housekeeping status change; keeps the open housekeeping task in step. */
export async function changeHousekeepingStatus(tx: Tx, actor: Actor, roomId: string, to: HousekeepingStatus, note?: string) {
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  assert(room.propertyId === actor.propertyId, "Room belongs to another property.");
  if (room.housekeepingStatus === to) return room;
  if (!HK_NEXT[room.housekeepingStatus].includes(to)) {
    throw new BusinessError(`A room cannot go from ${room.housekeepingStatus.replaceAll("_", " ").toLowerCase()} to ${to.replaceAll("_", " ").toLowerCase()}.`);
  }
  const updated = await setRoomStatus(tx, actor, roomId, { housekeepingStatus: to }, note ?? "Housekeeping update");
  const task = await tx.housekeepingTask.findFirst({ where: { roomId, status: { in: ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED"] } }, orderBy: { createdAt: "desc" } });
  if (task) {
    const now = new Date();
    const data =
      to === "CLEANING_IN_PROGRESS" ? { status: "IN_PROGRESS" as const, startedAt: now }
      : to === "CLEAN" ? { status: "COMPLETED" as const, completedAt: now }
      : to === "INSPECTED" ? { status: "INSPECTED" as const, inspectedAt: now, inspectedBy: actor.userId }
      : null;
    if (data) await tx.housekeepingTask.update({ where: { id: task.id }, data });
  } else if (to === "DIRTY") {
    await createHousekeepingTask(tx, actor, { roomId, type: "DAILY", sourceType: null, sourceId: null });
  }
  await audit(tx, actor, "room.housekeeping", "Room", roomId, `Room ${room.number}: ${room.housekeepingStatus} → ${to}`);
  return updated;
}

export async function createHousekeepingTask(
  tx: Tx,
  actor: Actor,
  input: { roomId: string; type: string; sourceType: string | null; sourceId: string | null; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"; notes?: string },
) {
  if (input.sourceType && input.sourceId) {
    const dup = await tx.housekeepingTask.findUnique({ where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } } });
    if (dup) return dup;
  }
  const task = await tx.housekeepingTask.create({
    data: {
      propertyId: actor.propertyId, roomId: input.roomId, type: input.type, priority: input.priority ?? "NORMAL",
      notes: input.notes, sourceType: input.sourceType, sourceId: input.sourceId, dueAt: new Date(Date.now() + 3 * 3600_000),
    },
    include: { room: true },
  });
  await notify(tx, actor.propertyId, { type: "HOUSEKEEPING_TASK", title: `Room ${task.room.number} needs cleaning`, body: input.type.replaceAll("_", " ").toLowerCase(), link: "/housekeeping" });
  return task;
}

/** Take a room out of inventory for a date range (maintenance, out of service, blocked). */
export async function blockRoom(
  tx: Tx,
  actor: Actor,
  input: { roomId: string; kind: Exclude<ServiceStatus, "IN_SERVICE">; startDate: Date; endDate: Date; reason: string; today: Date },
) {
  assert(input.endDate > input.startDate, "Block end date must be after the start date.");
  const room = await tx.room.findUniqueOrThrow({ where: { id: input.roomId } });
  assert(room.propertyId === actor.propertyId, "Room belongs to another property.");
  const clash = await tx.reservationRoom.findFirst({
    where: { roomId: room.id, status: { in: ["RESERVED", "CHECKED_IN"] }, checkIn: { lt: input.endDate }, checkOut: { gt: input.startDate } },
    include: { reservation: true },
  });
  if (clash) throw new BusinessError(`Room ${room.number} is assigned to reservation ${clash.reservation.reference} in that period. Move the guest first.`);
  const block = await tx.roomBlock.create({
    data: { propertyId: actor.propertyId, roomId: room.id, kind: input.kind, startDate: input.startDate, endDate: input.endDate, reason: input.reason, createdBy: actor.userId },
  });
  if (input.startDate <= input.today && input.endDate > input.today) {
    await setRoomStatus(tx, actor, room.id, { serviceStatus: input.kind }, input.reason);
  }
  await audit(tx, actor, "room.block", "Room", room.id, `Room ${room.number} ${input.kind.toLowerCase()} until ${input.endDate.toISOString().slice(0, 10)}: ${input.reason}`);
  return block;
}

export async function releaseRoom(tx: Tx, actor: Actor, roomId: string, today: Date) {
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  assert(room.propertyId === actor.propertyId, "Room belongs to another property.");
  await tx.roomBlock.updateMany({ where: { roomId, releasedAt: null, endDate: { gt: today } }, data: { releasedAt: new Date() } });
  await setRoomStatus(tx, actor, roomId, { serviceStatus: "IN_SERVICE", housekeepingStatus: room.serviceStatus === "IN_SERVICE" ? undefined : "DIRTY" }, "Returned to service");
  if (room.serviceStatus !== "IN_SERVICE") await createHousekeepingTask(tx, actor, { roomId, type: "INSPECTION", sourceType: "ROOM_RELEASE", sourceId: `${roomId}:${Date.now()}` });
  await audit(tx, actor, "room.release", "Room", roomId, `Room ${room.number} returned to service`);
}

/** Daily job: put rooms whose block starts today out of service and return expired blocks. */
export async function syncRoomBlocks(tx: Tx, actor: Actor, today: Date) {
  const starting = await tx.roomBlock.findMany({ where: { propertyId: actor.propertyId, releasedAt: null, startDate: { lte: today }, endDate: { gt: today } } });
  for (const b of starting) await setRoomStatus(tx, actor, b.roomId, { serviceStatus: b.kind }, b.reason);
  const ended = await tx.roomBlock.findMany({ where: { propertyId: actor.propertyId, releasedAt: null, endDate: { lte: today } } });
  for (const b of ended) {
    await tx.roomBlock.update({ where: { id: b.id }, data: { releasedAt: new Date() } });
    const stillBlocked = await tx.roomBlock.count({ where: { roomId: b.roomId, releasedAt: null, startDate: { lte: today }, endDate: { gt: addDays(today, 0) } } });
    if (!stillBlocked) await setRoomStatus(tx, actor, b.roomId, { serviceStatus: "IN_SERVICE" }, "Block ended");
  }
}
