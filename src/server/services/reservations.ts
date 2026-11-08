import { Prisma, type BookingSource, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, round2, sum } from "@/lib/money";
import { diffNights, toDateOnlyString } from "@/lib/dates";
import { assertRoomFree, typeAvailability } from "./availability";
import { loadRoomType, quoteNights, totalsFor } from "./pricing";
import { applyDeposits, openFolio, postCharge, recordPayment, unappliedDeposits } from "./folio";
import { ACC } from "./ledger";
import { createHousekeepingTask, setRoomStatus } from "./rooms";
import {
  BusinessError, assert, audit, claimIdempotencyKey, completeIdempotencyKey, lockProperty, nextNumber, notify, pad, type Actor,
} from "./common";

export type GuestInput = {
  firstName: string; lastName: string; email?: string | null; phone?: string | null; nationality?: string | null;
  country?: string | null; address?: string | null; company?: string | null; emergencyContactName?: string | null;
  emergencyContactPhone?: string | null; idType?: string | null; idNumber?: string | null;
};

export type RoomLineInput = { roomTypeId: string; roomId?: string | null; adults: number; children: number };

export type CreateReservationInput = {
  guestId?: string | null;
  guest?: GuestInput;
  source: BookingSource;
  checkIn: Date;
  checkOut: Date;
  rooms: RoomLineInput[];
  specialRequests?: string | null;
  notes?: string | null;
  companyName?: string | null;
  groupName?: string | null;
  discount?: Prisma.Decimal.Value;
  status?: "PENDING" | "CONFIRMED";
  deposit?: { amount: Prisma.Decimal.Value; method: PaymentMethod; reference?: string | null } | null;
  idempotencyKey: string;
  today: Date;
  isDemo?: boolean;
};

export async function findOrCreateGuest(tx: Tx, actor: Actor, guestId: string | null | undefined, g: GuestInput | undefined) {
  if (guestId) {
    const guest = await tx.guest.findFirst({ where: { id: guestId, propertyId: actor.propertyId } });
    if (!guest) throw new BusinessError("Guest not found.");
    return guest;
  }
  if (!g) throw new BusinessError("Guest details are required.");
  // Returning-guest match on email or phone avoids duplicate profiles.
  const match = g.email || g.phone
    ? await tx.guest.findFirst({
        where: {
          propertyId: actor.propertyId,
          OR: [...(g.email ? [{ email: { equals: g.email, mode: "insensitive" as const } }] : []), ...(g.phone ? [{ phone: g.phone }] : [])],
        },
      })
    : null;
  const { idType, idNumber, ...profile } = g;
  const guest = match
    ? await tx.guest.update({ where: { id: match.id }, data: Object.fromEntries(Object.entries(profile).filter(([, v]) => v)) })
    : await tx.guest.create({ data: { ...profile, propertyId: actor.propertyId } });
  if (idType && idNumber) {
    const doc = await tx.guestDocument.findFirst({ where: { guestId: guest.id, type: idType, number: idNumber } });
    if (!doc) await tx.guestDocument.create({ data: { guestId: guest.id, type: idType, number: idNumber } });
  }
  return guest;
}

async function checkLinesAvailable(
  tx: Tx,
  actor: Actor,
  checkIn: Date,
  checkOut: Date,
  lines: RoomLineInput[],
  today: Date,
  excludeLineIds: string[] = [],
) {
  const byType = new Map<string, number>();
  for (const l of lines) byType.set(l.roomTypeId, (byType.get(l.roomTypeId) ?? 0) + 1);
  for (const [roomTypeId, needed] of byType) {
    const free = await typeAvailability(tx, actor.propertyId, roomTypeId, checkIn, checkOut, { excludeLineIds, today });
    if (free < needed) {
      const rt = await tx.roomType.findUnique({ where: { id: roomTypeId } });
      throw new BusinessError(
        free === 0 ? `No ${rt?.name ?? "rooms"} available for those dates.` : `Only ${free} ${rt?.name ?? "room"}(s) available for those dates.`,
      );
    }
  }
  const assigned = lines.filter((l) => l.roomId).map((l) => l.roomId!);
  if (new Set(assigned).size !== assigned.length) throw new BusinessError("The same room was selected twice.");
  for (const l of lines) {
    if (!l.roomId) continue;
    const room = await assertRoomFree(tx, actor.propertyId, l.roomId, checkIn, checkOut, { excludeLineIds, today });
    if (room.roomTypeId !== l.roomTypeId) throw new BusinessError(`Room ${room.number} is not a room of the selected type.`);
  }
}

export async function recalcReservationTotals(tx: Tx, reservationId: string) {
  const res = await tx.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { property: true, rooms: { where: { status: { not: "CANCELLED" } }, include: { nights: true } } },
  });
  const nights = res.rooms.flatMap((r) => r.nights);
  const t = totalsFor(nights, res.discountAmount, res.property);
  const active = res.rooms.length ? res.rooms : [];
  return tx.reservation.update({
    where: { id: reservationId },
    data: {
      roomTotal: t.roomTotal, extrasTotal: t.extrasTotal, serviceCharge: t.serviceCharge, taxTotal: t.tax, grandTotal: t.grandTotal,
      ...(active.length
        ? {
            checkIn: new Date(Math.min(...active.map((r) => r.checkIn.getTime()))),
            checkOut: new Date(Math.max(...active.map((r) => r.checkOut.getTime()))),
            adults: active.reduce((a, r) => a + r.adults, 0),
            children: active.reduce((a, r) => a + r.children, 0),
          }
        : {}),
    },
  });
}

/** Workflow 1: availability → reservation → room inventory → deposit → confirmation. */
export async function createReservation(tx: Tx, actor: Actor, input: CreateReservationInput) {
  const claim = await claimIdempotencyKey(tx, input.idempotencyKey, "reservation.create");
  if (!claim.fresh) {
    assert(claim.resultId, "This booking is already being processed.");
    return tx.reservation.findUniqueOrThrow({ where: { id: claim.resultId } });
  }
  assert(input.rooms.length > 0, "Add at least one room.");
  assert(input.checkOut > input.checkIn, "Check-out must be after check-in.");
  assert(input.checkIn >= input.today, "Check-in date cannot be in the past.");
  assert(diffNights(input.checkIn, input.checkOut) <= 365, "Stays longer than 365 nights are not supported.");

  await lockProperty(tx, actor.propertyId);
  await checkLinesAvailable(tx, actor, input.checkIn, input.checkOut, input.rooms, input.today);

  const property = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  const guest = await findOrCreateGuest(tx, actor, input.guestId, input.guest);

  const lineQuotes = [];
  for (const line of input.rooms) {
    const rt = await loadRoomType(tx, actor.propertyId, line.roomTypeId);
    lineQuotes.push({ line, nights: quoteNights(rt, input.checkIn, input.checkOut, line.adults, line.children) });
  }
  const discount = round2(input.discount ?? 0);
  const gross = sum(lineQuotes.flatMap((q) => q.nights.map((n) => n.rate.plus(n.extraCharge))));
  assert(!discount.isNegative() && discount.lessThanOrEqualTo(gross), "Discount cannot exceed the room charges.");
  const totals = totalsFor(lineQuotes.flatMap((q) => q.nights), discount, property);

  const seq = await nextNumber(tx, actor.propertyId, `RES${input.today.getUTCFullYear()}`);
  const reference = `${property.code}-${input.today.getUTCFullYear()}-${pad(seq, 5)}`;

  const reservation = await tx.reservation.create({
    data: {
      propertyId: actor.propertyId, reference, guestId: guest.id, source: input.source, status: input.status ?? "CONFIRMED",
      checkIn: input.checkIn, checkOut: input.checkOut,
      adults: input.rooms.reduce((a, r) => a + r.adults, 0), children: input.rooms.reduce((a, r) => a + r.children, 0),
      isGroup: input.rooms.length > 1, groupName: input.groupName || null, companyName: input.companyName || null,
      specialRequests: input.specialRequests || null, notes: input.notes || null, discountAmount: discount,
      roomTotal: totals.roomTotal, extrasTotal: totals.extrasTotal, serviceCharge: totals.serviceCharge, taxTotal: totals.tax, grandTotal: totals.grandTotal,
      createdById: actor.userId, isDemo: input.isDemo ?? false,
      rooms: {
        create: lineQuotes.map(({ line, nights }) => ({
          roomTypeId: line.roomTypeId, roomId: line.roomId || null, checkIn: input.checkIn, checkOut: input.checkOut,
          adults: line.adults, children: line.children,
          nights: { create: nights.map((n) => ({ date: n.date, rate: n.rate, extraCharge: n.extraCharge, rateName: n.rateName })) },
        })),
      },
      events: { create: { type: "CREATED", description: `Reservation created via ${input.source.replaceAll("_", " ").toLowerCase()}`, userId: actor.userId } },
    },
  });
  const folio = await openFolio(tx, actor, reservation.id);

  if (input.deposit && D(input.deposit.amount).greaterThan(0)) {
    assert(D(input.deposit.amount).lessThanOrEqualTo(totals.grandTotal), "Advance payment cannot exceed the reservation total.");
    await recordPayment(tx, actor, {
      folioId: folio.id, kind: "DEPOSIT", method: input.deposit.method, amount: input.deposit.amount,
      reference: input.deposit.reference, idempotencyKey: `${input.idempotencyKey}:deposit`, date: input.today,
    });
    await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: "PAYMENT", description: `Advance deposit ${D(input.deposit.amount).toFixed(2)} received`, userId: actor.userId } });
  }

  await audit(tx, actor, "reservation.create", "Reservation", reservation.id, `Created ${reference} for ${guest.firstName} ${guest.lastName}`, { after: { reference, checkIn: input.checkIn, checkOut: input.checkOut, rooms: input.rooms.length } });
  await notify(tx, actor.propertyId, { type: "NEW_RESERVATION", title: `New reservation ${reference}`, body: `${guest.firstName} ${guest.lastName}, ${toDateOnlyString(input.checkIn)} → ${toDateOnlyString(input.checkOut)}`, link: `/reservations/${reservation.id}` });
  if (guest.email) {
    // No email provider is configured yet: record the confirmation honestly as not sent.
    await tx.notification.create({
      data: { propertyId: actor.propertyId, type: "BOOKING_CONFIRMATION", title: `Confirmation for ${reference}`, body: `To ${guest.email}`, link: `/reservations/${reservation.id}/voucher`, channel: "EMAIL", delivery: process.env.EMAIL_PROVIDER ? "QUEUED" : "NOT_CONFIGURED" },
    });
  }
  await completeIdempotencyKey(tx, input.idempotencyKey, reservation.id);
  return reservation;
}

async function rebuildNights(tx: Tx, lineId: string, checkIn: Date, checkOut: Date) {
  const line = await tx.reservationRoom.findUniqueOrThrow({ where: { id: lineId }, include: { nights: true } });
  const rt = await loadRoomType(tx, (await tx.reservation.findUniqueOrThrow({ where: { id: line.reservationId } })).propertyId, line.roomTypeId);
  const quotes = quoteNights(rt, checkIn, checkOut, line.adults, line.children);
  const wanted = new Set(quotes.map((q) => toDateOnlyString(q.date)));
  const posted = line.nights.filter((n) => n.postedAt);
  for (const n of posted) {
    if (!wanted.has(toDateOnlyString(n.date))) throw new BusinessError(`The night of ${toDateOnlyString(n.date)} is already charged and cannot be removed.`);
  }
  // Keep existing (rate-locked) nights; add new ones at today's rates; drop unposted nights outside the stay.
  const existing = new Set(line.nights.map((n) => toDateOnlyString(n.date)));
  await tx.reservationNight.deleteMany({ where: { reservationRoomId: lineId, postedAt: null, date: { notIn: quotes.map((q) => q.date) } } });
  const toAdd = quotes.filter((q) => !existing.has(toDateOnlyString(q.date)));
  if (toAdd.length) await tx.reservationNight.createMany({ data: toAdd.map((q) => ({ reservationRoomId: lineId, date: q.date, rate: q.rate, extraCharge: q.extraCharge, rateName: q.rateName })) });
}

/** Change dates of a reservation (all active room lines): extend, shorten or move. */
export async function changeStayDates(tx: Tx, actor: Actor, reservationId: string, checkIn: Date, checkOut: Date, today: Date) {
  assert(checkOut > checkIn, "Check-out must be after check-in.");
  await lockProperty(tx, actor.propertyId);
  const res = await tx.reservation.findFirstOrThrow({ where: { id: reservationId, propertyId: actor.propertyId }, include: { rooms: { include: { room: true } } } });
  assert(["PENDING", "CONFIRMED", "CHECKED_IN"].includes(res.status), "Only upcoming or in-house reservations can be changed.");
  const lines = res.rooms.filter((r) => r.status === "RESERVED" || r.status === "CHECKED_IN");
  const inHouse = lines.some((l) => l.status === "CHECKED_IN");
  if (inHouse) {
    assert(checkIn.getTime() === res.checkIn.getTime(), "The arrival date of an in-house guest cannot be changed.");
    assert(checkOut > today, "Check-out cannot be before tomorrow for an in-house guest. Use check-out instead.");
  } else {
    assert(checkIn >= today, "Check-in date cannot be in the past.");
  }
  const ids = lines.map((l) => l.id);
  await checkLinesAvailable(tx, actor, checkIn, checkOut, lines.map((l) => ({ roomTypeId: l.room?.roomTypeId ?? l.roomTypeId, roomId: l.roomId, adults: l.adults, children: l.children })), today, ids);
  for (const l of lines) {
    await tx.reservationRoom.update({ where: { id: l.id }, data: { checkIn, checkOut } });
    await rebuildNights(tx, l.id, checkIn, checkOut);
  }
  const oldNights = diffNights(res.checkIn, res.checkOut);
  const newNights = diffNights(checkIn, checkOut);
  const type = newNights > oldNights ? "EXTENDED" : newNights < oldNights ? "SHORTENED" : "MODIFIED";
  const description = `Stay ${type.toLowerCase()}: ${toDateOnlyString(res.checkIn)}→${toDateOnlyString(res.checkOut)} is now ${toDateOnlyString(checkIn)}→${toDateOnlyString(checkOut)}`;
  await tx.reservationEvent.create({ data: { reservationId, type, description, userId: actor.userId } });
  const updated = await recalcReservationTotals(tx, reservationId);
  await audit(tx, actor, "reservation.dates", "Reservation", reservationId, `${res.reference}: ${description}`, { before: { checkIn: res.checkIn, checkOut: res.checkOut }, after: { checkIn, checkOut } });
  await notify(tx, actor.propertyId, { type: "BOOKING_MODIFIED", title: `${res.reference} ${type.toLowerCase()}`, body: description, link: `/reservations/${reservationId}` });
  return updated;
}

/** Assign or move a room line to a specific room (and optionally new dates — used by the calendar). */
export async function moveRoomLine(
  tx: Tx,
  actor: Actor,
  input: { lineId: string; roomId: string | null; checkIn?: Date; checkOut?: Date; today: Date; requireInspection?: boolean },
) {
  await lockProperty(tx, actor.propertyId);
  const line = await tx.reservationRoom.findUniqueOrThrow({ where: { id: input.lineId }, include: { reservation: true, room: true } });
  assert(line.reservation.propertyId === actor.propertyId, "Reservation belongs to another property.");
  assert(line.status === "RESERVED" || line.status === "CHECKED_IN", "Only upcoming or in-house rooms can be moved.");
  const checkIn = input.checkIn ?? line.checkIn;
  const checkOut = input.checkOut ?? line.checkOut;
  const datesChanged = checkIn.getTime() !== line.checkIn.getTime() || checkOut.getTime() !== line.checkOut.getTime();
  if (line.status === "CHECKED_IN") assert(!datesChanged || checkIn.getTime() === line.checkIn.getTime(), "An in-house guest's arrival date cannot be moved.");
  if (datesChanged) assert(line.status === "CHECKED_IN" || checkIn >= input.today, "Check-in date cannot be in the past.");
  assert(checkOut > checkIn, "Check-out must be after check-in.");

  // Inventory is counted against the physical room's type; the guest keeps the booked type and rate (upgrade/downgrade is free).
  let inventoryType = line.roomTypeId;
  if (input.roomId) {
    const room = await assertRoomFree(tx, actor.propertyId, input.roomId, checkIn, checkOut, { excludeLineIds: [line.id], today: input.today });
    if (line.status === "CHECKED_IN" && input.roomId !== line.roomId) {
      const ready = room.occupancyStatus === "VACANT" && room.serviceStatus === "IN_SERVICE" && (room.housekeepingStatus === "INSPECTED" || (!input.requireInspection && room.housekeepingStatus === "CLEAN"));
      assert(ready, `Room ${room.number} is not ready for occupancy.`);
    }
    inventoryType = room.roomTypeId;
  }
  if (!input.roomId || datesChanged) {
    await checkLinesAvailable(tx, actor, checkIn, checkOut, [{ roomTypeId: inventoryType, roomId: input.roomId, adults: line.adults, children: line.children }], input.today, [line.id]);
  }
  await tx.reservationRoom.update({ where: { id: line.id }, data: { roomId: input.roomId, checkIn, checkOut } });
  if (datesChanged) await rebuildNights(tx, line.id, checkIn, checkOut);

  if (line.status === "CHECKED_IN" && input.roomId && line.roomId && input.roomId !== line.roomId) {
    await setRoomStatus(tx, actor, line.roomId, { occupancyStatus: "VACANT", housekeepingStatus: "DIRTY" }, `Guest moved to another room (${line.reservation.reference})`);
    await setRoomStatus(tx, actor, input.roomId, { occupancyStatus: "OCCUPIED" }, `Guest moved in (${line.reservation.reference})`);
    await createHousekeepingTask(tx, actor, { roomId: line.roomId, type: "CHECKOUT_CLEAN", sourceType: "ROOM_MOVE", sourceId: `${line.id}:${Date.now()}` });
  }
  const newRoom = input.roomId ? await tx.room.findUnique({ where: { id: input.roomId } }) : null;
  const description = `${line.room ? `Room ${line.room.number}` : "Unassigned"} → ${newRoom ? `Room ${newRoom.number}` : "Unassigned"}${datesChanged ? `, dates ${toDateOnlyString(checkIn)}→${toDateOnlyString(checkOut)}` : ""}`;
  await tx.reservationEvent.create({ data: { reservationId: line.reservationId, type: line.roomId ? "ROOM_CHANGED" : "ROOM_ASSIGNED", description, userId: actor.userId } });
  await recalcReservationTotals(tx, line.reservationId);
  await audit(tx, actor, "reservation.room", "Reservation", line.reservationId, `${line.reservation.reference}: ${description}`);
}

/**
 * Cancel a reservation. Releases inventory, refunds what the user chooses to refund,
 * and recognises any retained deposit as a cancellation fee.
 */
export async function cancelReservation(
  tx: Tx,
  actor: Actor,
  input: { reservationId: string; reason: string; refundAmount: Prisma.Decimal.Value; refundMethod: PaymentMethod; idempotencyKey: string; today: Date; noShow?: boolean },
) {
  const res = await tx.reservation.findFirstOrThrow({ where: { id: input.reservationId, propertyId: actor.propertyId }, include: { folio: true, guest: true } });
  assert(res.status === "PENDING" || res.status === "CONFIRMED", "Only reservations that have not checked in can be cancelled.");
  assert(res.folio, "Reservation has no folio.");
  const held = await unappliedDeposits(tx, res.folio.id);
  const refund = round2(input.refundAmount);
  assert(!refund.isNegative() && refund.lessThanOrEqualTo(held), `Refund must be between 0 and the ${held.toFixed(2)} deposit held.`);
  if (refund.greaterThan(0)) {
    await recordPayment(tx, actor, { folioId: res.folio.id, kind: "REFUND", refundOf: "DEPOSIT", method: input.refundMethod, amount: refund, idempotencyKey: `${input.idempotencyKey}:refund`, date: input.today, notes: `Cancellation refund ${res.reference}` });
  }
  const retained = held.minus(refund);
  if (retained.greaterThan(0)) {
    await postCharge(tx, actor, {
      folioId: res.folio.id, type: "ADJUSTMENT", description: input.noShow ? "No-show fee (retained deposit)" : "Cancellation fee (retained deposit)",
      amount: retained, serviceDate: input.today, revenueAccount: ACC.ROOM_REVENUE, sourceType: "CANCELLATION_FEE", sourceId: res.id, applyServiceAndTax: false,
    });
  }
  await applyDeposits(tx, actor, res.folio.id, input.today);
  const status = input.noShow ? "NO_SHOW" : "CANCELLED";
  await tx.reservationRoom.updateMany({ where: { reservationId: res.id, status: "RESERVED" }, data: { status } });
  await tx.folio.update({ where: { id: res.folio.id }, data: { status: "CLOSED", closedAt: new Date() } });
  await tx.reservation.update({ where: { id: res.id }, data: { status, cancelledAt: new Date(), cancelReason: input.reason } });
  await tx.reservationEvent.create({ data: { reservationId: res.id, type: status, description: `${input.noShow ? "Marked no-show" : "Cancelled"}: ${input.reason}. Refunded ${refund.toFixed(2)}, retained ${retained.toFixed(2)}.`, userId: actor.userId } });
  await audit(tx, actor, `reservation.${status.toLowerCase()}`, "Reservation", res.id, `${res.reference} ${status.toLowerCase()} — ${input.reason}`, { after: { refund: refund.toFixed(2), retained: retained.toFixed(2) } });
  await notify(tx, actor.propertyId, { type: "BOOKING_CANCELLED", title: `${res.reference} ${input.noShow ? "no-show" : "cancelled"}`, body: `${res.guest.firstName} ${res.guest.lastName}`, link: `/reservations/${res.id}` });
}

export async function updateReservationDetails(
  tx: Tx,
  actor: Actor,
  id: string,
  data: { source?: BookingSource; specialRequests?: string | null; notes?: string | null; companyName?: string | null; groupName?: string | null; discount?: Prisma.Decimal.Value; status?: "PENDING" | "CONFIRMED" },
) {
  const res = await tx.reservation.findFirstOrThrow({ where: { id, propertyId: actor.propertyId } });
  assert(!["CHECKED_OUT", "CANCELLED", "NO_SHOW"].includes(res.status), "Closed reservations cannot be edited.");
  if (data.status) assert(res.status === "PENDING" || res.status === "CONFIRMED", "Status can only switch between pending and confirmed.");
  const { discount, ...rest } = data;
  const updated = await tx.reservation.update({ where: { id }, data: { ...rest, ...(discount !== undefined ? { discountAmount: round2(discount) } : {}) } });
  if (discount !== undefined) {
    const gross = await tx.reservationNight.aggregate({ where: { reservationRoom: { reservationId: id, status: { not: "CANCELLED" } } }, _sum: { rate: true, extraCharge: true } });
    assert(round2(discount).lessThanOrEqualTo(D(gross._sum.rate).plus(D(gross._sum.extraCharge))), "Discount cannot exceed the room charges.");
    await recalcReservationTotals(tx, id);
  }
  await tx.reservationEvent.create({ data: { reservationId: id, type: "MODIFIED", description: "Reservation details updated", data: JSON.parse(JSON.stringify(data)), userId: actor.userId } });
  await audit(tx, actor, "reservation.update", "Reservation", id, `${res.reference} details updated`, { before: res, after: updated });
  return updated;
}

