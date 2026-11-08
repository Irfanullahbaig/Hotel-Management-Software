import type { Tx } from "@/lib/db";
import { eachNight, toDateOnlyString } from "@/lib/dates";
import { BusinessError } from "./common";

const ACTIVE_LINE = ["RESERVED", "CHECKED_IN"] as const;

/** Rooms of the property that can be sold for every night in [checkIn, checkOut). */
export async function availableRooms(
  tx: Tx,
  propertyId: string,
  checkIn: Date,
  checkOut: Date,
  opts: { roomTypeId?: string; excludeLineIds?: string[]; today?: Date } = {},
) {
  const rooms = await tx.room.findMany({
    where: { propertyId, isActive: true, roomTypeId: opts.roomTypeId },
    include: {
      roomType: true,
      blocks: { where: { releasedAt: null, startDate: { lt: checkOut }, endDate: { gt: checkIn } } },
      reservationRooms: {
        where: {
          status: { in: [...ACTIVE_LINE] },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
          id: opts.excludeLineIds?.length ? { notIn: opts.excludeLineIds } : undefined,
        },
        select: { id: true },
      },
    },
    orderBy: [{ floor: "asc" }, { number: "asc" }],
  });
  const stayIncludesToday = opts.today ? checkIn <= opts.today && checkOut > opts.today : false;
  return rooms.filter(
    (r) =>
      r.blocks.length === 0 &&
      r.reservationRooms.length === 0 &&
      !(stayIncludesToday && r.serviceStatus !== "IN_SERVICE"),
  );
}

/**
 * How many rooms of a type are still sellable on the tightest night of the stay.
 * Counts both assigned and unassigned reservation lines.
 */
export async function typeAvailability(
  tx: Tx,
  propertyId: string,
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  opts: { excludeLineIds?: string[]; today?: Date } = {},
) {
  const nights = eachNight(checkIn, checkOut).map(toDateOnlyString);
  const rooms = await tx.room.findMany({
    where: { propertyId, roomTypeId, isActive: true },
    include: { blocks: { where: { releasedAt: null, startDate: { lt: checkOut }, endDate: { gt: checkIn } } } },
  });
  const lines = await tx.reservationRoom.findMany({
    where: {
      reservation: { propertyId },
      status: { in: [...ACTIVE_LINE] },
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
      id: opts.excludeLineIds?.length ? { notIn: opts.excludeLineIds } : undefined,
      OR: [{ roomId: null, roomTypeId }, { room: { roomTypeId } }],
    },
    select: { checkIn: true, checkOut: true, roomId: true },
  });
  let min = Infinity;
  const todayStr = opts.today ? toDateOnlyString(opts.today) : null;
  for (const night of nights) {
    const sellable = rooms.filter(
      (r) =>
        !r.blocks.some((b) => toDateOnlyString(b.startDate) <= night && toDateOnlyString(b.endDate) > night) &&
        !(night === todayStr && r.serviceStatus !== "IN_SERVICE"),
    ).length;
    const sold = lines.filter((l) => toDateOnlyString(l.checkIn) <= night && toDateOnlyString(l.checkOut) > night).length;
    min = Math.min(min, sellable - sold);
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

export async function assertRoomFree(
  tx: Tx,
  propertyId: string,
  roomId: string,
  checkIn: Date,
  checkOut: Date,
  opts: { excludeLineIds?: string[]; today?: Date } = {},
) {
  const room = await tx.room.findFirst({ where: { id: roomId, propertyId } });
  if (!room || !room.isActive) throw new BusinessError("Room not found.");
  const free = await availableRooms(tx, propertyId, checkIn, checkOut, { ...opts, roomTypeId: room.roomTypeId });
  if (!free.some((r) => r.id === roomId)) {
    throw new BusinessError(`Room ${room.number} is not available for those dates.`);
  }
  return room;
}

export function isReadyForCheckIn(
  room: { occupancyStatus: string; serviceStatus: string; housekeepingStatus: string },
  requireInspection: boolean,
) {
  if (room.occupancyStatus !== "VACANT" || room.serviceStatus !== "IN_SERVICE") return false;
  return room.housekeepingStatus === "INSPECTED" || (!requireInspection && room.housekeepingStatus === "CLEAN");
}
