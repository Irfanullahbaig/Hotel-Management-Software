import { earnStayPoints } from "./crm";
import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, round2 } from "@/lib/money";
import { addDays, toDateOnlyString } from "@/lib/dates";
import { assertRoomFree, isReadyForCheckIn } from "./availability";
import { applyDeposits, folioBalance, generateInvoice, postDiscount, postNight, recordPayment } from "./folio";
import { changeStayDates, createReservation, recalcReservationTotals, type CreateReservationInput } from "./reservations";
import { extraPersonCharge } from "./pricing";
import { createHousekeepingTask, setRoomStatus } from "./rooms";
import { BusinessError, assert, audit, claimIdempotencyKey, completeIdempotencyKey, lockProperty, notify, type Actor } from "./common";

export type CheckInInput = {
  reservationId: string;
  lines: { lineId: string; roomId: string; adults: number; children: number }[];
  document?: { type: string; number: string; issuingCountry?: string | null; expiryDate?: Date | null } | null;
  documentVerified: boolean;
  specialRequests?: string | null;
  payment?: { amount: Prisma.Decimal.Value; method: PaymentMethod; reference?: string | null } | null;
  idempotencyKey: string;
  today: Date;
};

/** Workflow 2: verify → assign ready room → occupy → activate folio. */
export async function checkIn(tx: Tx, actor: Actor, input: CheckInInput) {
  const claim = await claimIdempotencyKey(tx, input.idempotencyKey, "checkin");
  if (!claim.fresh) return;
  await lockProperty(tx, actor.propertyId);
  const property = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  const res = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId: actor.propertyId }, include: { rooms: { include: { roomType: true } }, guest: { include: { documents: true } }, folio: true } });
  if (!res) throw new BusinessError("Reservation not found.");
  assert(res.status === "CONFIRMED" || res.status === "PENDING" || res.status === "CHECKED_IN", `A ${res.status.toLowerCase().replace("_", " ")} reservation cannot be checked in.`);
  assert(res.checkIn <= input.today, `This reservation arrives on ${toDateOnlyString(res.checkIn)}. Change the dates to check in early.`);
  assert(res.checkOut > input.today, "The stay has already ended. Change the dates before checking in.");
  assert(input.lines.length > 0, "Select at least one room to check in.");
  assert(input.documentVerified, "Confirm that the guest's identification has been verified.");
  if (!input.document && res.guest.documents.length === 0) throw new BusinessError("Record the guest's identification document.");

  for (const sel of input.lines) {
    const line = res.rooms.find((l) => l.id === sel.lineId);
    assert(line && line.status === "RESERVED", "One of the selected rooms is not awaiting check-in.");
    const room = await assertRoomFree(tx, actor.propertyId, sel.roomId, line.checkIn, line.checkOut, { excludeLineIds: [line.id], today: input.today });
    assert(isReadyForCheckIn(room, property.requireInspection), `Room ${room.number} is not ready for occupancy (${room.housekeepingStatus.toLowerCase().replaceAll("_", " ")}).`);
    const rt = line.roomType;
    assert(sel.adults >= 1 && sel.adults + sel.children <= rt.maxOccupancy && sel.adults <= rt.maxAdults, `Too many occupants for ${rt.name}.`);
    const occupantsChanged = sel.adults !== line.adults || sel.children !== line.children;
    const roomTypeChanged = room.roomTypeId !== line.roomTypeId;
    await tx.reservationRoom.update({
      where: { id: line.id },
      data: { roomId: room.id, adults: sel.adults, children: sel.children, status: "CHECKED_IN", checkedInAt: new Date(), checkedInBy: actor.userId },
    });
    if (occupantsChanged) {
      // Re-price extra-person charges for the nights not yet posted.
      const extra = extraPersonCharge(rt, sel.adults, sel.children);
      await tx.reservationNight.updateMany({ where: { reservationRoomId: line.id, postedAt: null }, data: { extraCharge: extra } });
    }
    await setRoomStatus(tx, actor, room.id, { occupancyStatus: "OCCUPIED" }, `Checked in ${res.reference}`);
    await tx.reservationEvent.create({ data: { reservationId: res.id, type: "CHECKED_IN", description: `Checked in to room ${room.number}${roomTypeChanged ? " (room type differs from booking; booked rate kept)" : ""}`, userId: actor.userId } });
  }
  if (input.document) {
    const existing = res.guest.documents.find((d) => d.type === input.document!.type && d.number === input.document!.number);
    if (existing) await tx.guestDocument.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), verifiedBy: actor.userId } });
    else await tx.guestDocument.create({ data: { guestId: res.guestId, ...input.document, verifiedAt: new Date(), verifiedBy: actor.userId } });
  } else {
    await tx.guestDocument.updateMany({ where: { guestId: res.guestId, verifiedAt: null }, data: { verifiedAt: new Date(), verifiedBy: actor.userId } });
  }
  await tx.reservation.update({ where: { id: res.id }, data: { status: "CHECKED_IN", specialRequests: input.specialRequests ?? res.specialRequests } });
  await recalcReservationTotals(tx, res.id);
  if (input.payment && D(input.payment.amount).greaterThan(0)) {
    await recordPayment(tx, actor, { folioId: res.folio!.id, kind: "DEPOSIT", method: input.payment.method, amount: input.payment.amount, reference: input.payment.reference, idempotencyKey: `${input.idempotencyKey}:pay`, date: input.today });
  }
  await audit(tx, actor, "frontdesk.checkin", "Reservation", res.id, `Checked in ${res.reference} (${input.lines.length} room(s))`);
  await completeIdempotencyKey(tx, input.idempotencyKey, res.id);
}

/** Walk-in: create a same-day reservation and check in, atomically. */
export async function walkIn(
  tx: Tx,
  actor: Actor,
  input: Omit<CreateReservationInput, "source" | "checkIn" | "status"> & { roomId: string; document: { type: string; number: string }; documentVerified: boolean },
) {
  const res = await createReservation(tx, actor, { ...input, source: "WALK_IN", checkIn: input.today, status: "CONFIRMED", deposit: null });
  const line = await tx.reservationRoom.findFirstOrThrow({ where: { reservationId: res.id } });
  await checkIn(tx, actor, {
    reservationId: res.id, lines: [{ lineId: line.id, roomId: input.roomId, adults: line.adults, children: line.children }],
    document: input.document, documentVerified: input.documentVerified, payment: input.deposit ?? null,
    idempotencyKey: `${input.idempotencyKey}:checkin`, today: input.today,
  });
  return res;
}

/** Night audit: post every in-house night up to and including the business date. */
export async function nightAudit(tx: Tx, actor: Actor, businessDate: Date) {
  const nights = await tx.reservationNight.findMany({
    where: { postedAt: null, date: { lte: businessDate }, reservationRoom: { status: "CHECKED_IN", reservation: { propertyId: actor.propertyId } } },
    select: { id: true },
  });
  for (const n of nights) await postNight(tx, actor, n.id);
  await audit(tx, actor, "frontdesk.night_audit", "Property", actor.propertyId, `Night audit ${toDateOnlyString(businessDate)}: posted ${nights.length} room night(s)`);
  return nights.length;
}

export type CheckOutInput = {
  reservationId: string;
  payment?: { amount: Prisma.Decimal.Value; method: PaymentMethod; reference?: string | null } | null;
  allowBalance: boolean;
  idempotencyKey: string;
  today: Date;
};

/**
 * Workflow 4: charges → discount → deposits → payment → invoice → room dirty → housekeeping task.
 * Runs inside one transaction.
 */
export async function checkOut(tx: Tx, actor: Actor, input: CheckOutInput) {
  const claim = await claimIdempotencyKey(tx, input.idempotencyKey, "checkout");
  if (!claim.fresh) {
    return tx.invoice.findFirstOrThrow({ where: { folio: { reservationId: input.reservationId } }, orderBy: { issuedAt: "desc" } });
  }
  const res = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId: actor.propertyId }, include: { rooms: { include: { room: true } }, folio: true, guest: true } });
  if (!res || !res.folio) throw new BusinessError("Reservation not found.");
  assert(res.status === "CHECKED_IN", "Only in-house reservations can be checked out.");
  const lines = res.rooms.filter((l) => l.status === "CHECKED_IN");
  const waiting = res.rooms.filter((l) => l.status === "RESERVED");
  assert(waiting.length === 0, "Some rooms on this reservation were never checked in. Check them in or cancel them first.");

  // Early departure: shorten to today. Late departure: extend to today (subject to availability).
  if (res.checkOut.getTime() !== input.today.getTime()) {
    assert(input.today > res.checkIn, "A guest cannot check out on the arrival day without staying a night. Cancel the stay instead.");
    await changeStayDates(tx, actor, res.id, res.checkIn, input.today, addDays(input.today, -1));
  }
  // Post all remaining nights.
  const unposted = await tx.reservationNight.findMany({ where: { reservationRoom: { reservationId: res.id, status: "CHECKED_IN" }, postedAt: null }, select: { id: true } });
  for (const n of unposted) await postNight(tx, actor, n.id);

  if (D(res.discountAmount).greaterThan(0)) await postDiscount(tx, actor, res.folio.id, res.discountAmount, input.today, res.id, `Reservation ${res.reference}`);
  await applyDeposits(tx, actor, res.folio.id, input.today);

  if (input.payment && D(input.payment.amount).greaterThan(0)) {
    const due = await folioBalance(tx, res.folio.id);
    assert(round2(input.payment.amount).lessThanOrEqualTo(due), `Payment exceeds the ${due.toFixed(2)} balance due.`);
    await recordPayment(tx, actor, { folioId: res.folio.id, kind: "SETTLEMENT", method: input.payment.method, amount: input.payment.amount, reference: input.payment.reference, idempotencyKey: `${input.idempotencyKey}:pay`, date: input.today });
  }
  let balance = await folioBalance(tx, res.folio.id);
  if (balance.isNegative()) {
    // Guest paid more than the final bill: refund the difference.
    await recordPayment(tx, actor, { folioId: res.folio.id, kind: "REFUND", refundOf: "RECEIVABLE", method: input.payment?.method ?? "CASH", amount: balance.negated(), idempotencyKey: `${input.idempotencyKey}:refund`, date: input.today, notes: "Overpayment refunded at check-out" });
    balance = await folioBalance(tx, res.folio.id);
  }
  if (balance.greaterThan(0) && !input.allowBalance) {
    throw new BusinessError(`The guest still owes ${balance.toFixed(2)}. Record the payment, or check out with an outstanding balance if you are permitted to.`);
  }

  const invoice = await generateInvoice(tx, actor, res.folio.id, `${res.guest.firstName} ${res.guest.lastName}${res.companyName ? `, ${res.companyName}` : ""}`);
  await earnStayPoints(tx, actor, res.guestId, invoice);
  for (const l of lines) {
    await tx.reservationRoom.update({ where: { id: l.id }, data: { status: "CHECKED_OUT", checkedOutAt: new Date(), checkedOutBy: actor.userId } });
    if (l.roomId) {
      await setRoomStatus(tx, actor, l.roomId, { occupancyStatus: "VACANT", housekeepingStatus: "DIRTY" }, `Checked out ${res.reference}`);
      await createHousekeepingTask(tx, actor, { roomId: l.roomId, type: "CHECKOUT_CLEAN", sourceType: "CHECKOUT", sourceId: l.id, priority: "HIGH" });
    }
  }
  await tx.reservation.update({ where: { id: res.id }, data: { status: "CHECKED_OUT" } });
  await tx.folio.update({ where: { id: res.folio.id }, data: balance.isZero() ? { status: "CLOSED", closedAt: new Date() } : {} });
  await tx.reservationEvent.create({ data: { reservationId: res.id, type: "CHECKED_OUT", description: `Checked out. Invoice ${invoice.number}${balance.isZero() ? ", fully paid" : `, balance ${balance.toFixed(2)} outstanding`}.`, userId: actor.userId } });
  await audit(tx, actor, "frontdesk.checkout", "Reservation", res.id, `Checked out ${res.reference}, invoice ${invoice.number}`, { after: { total: invoice.total, balance } });
  if (balance.greaterThan(0)) await notify(tx, actor.propertyId, { type: "OUTSTANDING_PAYMENT", title: `${res.reference} checked out with ${balance.toFixed(2)} outstanding`, link: `/reservations/${res.id}` });
  await completeIdempotencyKey(tx, input.idempotencyKey, invoice.id);
  return invoice;
}

class PreviewRollback extends Error {
  constructor(public result: unknown) { super("preview"); }
}

/**
 * Exact check-out preview: runs the real posting steps in a transaction and rolls it back,
 * so the screen shows precisely what check-out will charge.
 */
export async function previewCheckOut(db: { $transaction: <T>(fn: (tx: Tx) => Promise<T>, o?: { timeout?: number }) => Promise<T> }, actor: Actor, reservationId: string, today: Date) {
  try {
    await db.$transaction(async (tx) => {
      const res = await tx.reservation.findFirstOrThrow({ where: { id: reservationId, propertyId: actor.propertyId }, include: { folio: true } });
      const notes: string[] = [];
      if (res.checkOut.getTime() !== today.getTime() && today > res.checkIn) {
        await changeStayDates(tx, actor, res.id, res.checkIn, today, addDays(today, -1));
        notes.push(today < res.checkOut ? `Early departure: the stay is shortened to end today (${toDateOnlyString(today)}).` : `Late departure: ${toDateOnlyString(res.checkOut)} → ${toDateOnlyString(today)}; extra nights are charged.`);
      }
      const unposted = await tx.reservationNight.findMany({ where: { reservationRoom: { reservationId: res.id, status: "CHECKED_IN" }, postedAt: null }, select: { id: true } });
      for (const n of unposted) await postNight(tx, actor, n.id);
      if (D(res.discountAmount).greaterThan(0)) await postDiscount(tx, actor, res.folio!.id, res.discountAmount, today, res.id, `Reservation ${res.reference}`);
      await applyDeposits(tx, actor, res.folio!.id, today);
      const txns = await tx.folioTransaction.findMany({ where: { folioId: res.folio!.id }, orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }] });
      const balance = await folioBalance(tx, res.folio!.id);
      throw new PreviewRollback({ txns: txns.map((t) => ({ id: t.id, date: toDateOnlyString(t.serviceDate), description: t.description, type: t.type, amount: t.amount.toFixed(2), projected: unposted.length > 0 && !t.journalEntryId ? true : false })), balance: balance.toFixed(2), notes, newlyPosted: unposted.length });
    }, { timeout: 20000 });
  } catch (e) {
    if (e instanceof PreviewRollback) return e.result as { txns: { id: string; date: string; description: string; type: string; amount: string }[]; balance: string; notes: string[]; newlyPosted: number };
    throw e;
  }
  throw new BusinessError("Preview failed.");
}
