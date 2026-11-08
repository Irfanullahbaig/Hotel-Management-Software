"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { D, formatMoney } from "@/lib/money";
import { businessToday, diffNights, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { can, requireProperty } from "@/server/auth/context";
import { availableRooms, typeAvailability } from "@/server/services/availability";
import { quoteNights, totalsFor } from "@/server/services/pricing";
import { cancelReservation, changeStayDates, createReservation, moveRoomLine, updateReservationDetails } from "@/server/services/reservations";
import { recordPayment } from "@/server/services/folio";
import { BusinessError } from "@/server/services/common";
import { formObject, mutate, toMessage, zs } from "./util";
import type { ActionState } from "./types";

const SOURCES = ["DIRECT", "WALK_IN", "PHONE", "WEBSITE", "TRAVEL_AGENT", "CORPORATE", "BOOKING_COM", "EXPEDIA", "AGODA", "AIRBNB", "OTHER_OTA"] as const;
const METHODS = ["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "CHEQUE", "ONLINE"] as const;

export type QuoteResult = {
  ok: boolean;
  error?: string;
  nights?: number;
  types?: { id: string; name: string; available: number; maxAdults: number; maxChildren: number; maxOccupancy: number; rooms: { id: string; number: string; ready: boolean }[] }[];
  lines?: { roomTypeId: string; subtotal: string; nightly: { date: string; rate: string; extra: string; name: string }[] }[];
  totals?: { roomTotal: string; extras: string; discount: string; serviceCharge: string; tax: string; grandTotal: string };
};

/** Read-only: live availability and price for the booking form. */
export async function quoteAction(input: { checkIn: string; checkOut: string; lines: { roomTypeId: string; adults: number; children: number }[]; discount?: number; excludeReservationId?: string }): Promise<QuoteResult> {
  try {
    const ctx = await requireProperty("reservations.view");
    const checkIn = parseDateOnly(input.checkIn), checkOut = parseDateOnly(input.checkOut);
    if (checkOut <= checkIn) return { ok: false, error: "Check-out must be after check-in." };
    if (diffNights(checkIn, checkOut) > 365) return { ok: false, error: "Stays longer than 365 nights are not supported." };
    const today = businessToday(ctx.property.timeZone);
    const exclude = input.excludeReservationId ? (await prisma.reservationRoom.findMany({ where: { reservationId: input.excludeReservationId }, select: { id: true } })).map((l) => l.id) : [];
    const types = await prisma.roomType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, include: { rates: true }, orderBy: { basePrice: "asc" } });
    const free = await availableRooms(prisma, ctx.property.id, checkIn, checkOut, { today, excludeLineIds: exclude });
    const typeInfo = await Promise.all(types.map(async (t) => ({
      id: t.id, name: t.name, maxAdults: t.maxAdults, maxChildren: t.maxChildren, maxOccupancy: t.maxOccupancy,
      available: await typeAvailability(prisma, ctx.property.id, t.id, checkIn, checkOut, { today, excludeLineIds: exclude }),
      rooms: free.filter((r) => r.roomTypeId === t.id).map((r) => ({ id: r.id, number: r.number, ready: r.occupancyStatus === "VACANT" && r.housekeepingStatus === "INSPECTED" })),
    })));
    const lines = [];
    const allNights = [];
    for (const l of input.lines) {
      const t = types.find((x) => x.id === l.roomTypeId);
      if (!t) continue;
      const nights = quoteNights(t, checkIn, checkOut, l.adults, l.children);
      allNights.push(...nights);
      lines.push({ roomTypeId: t.id, subtotal: nights.reduce((a, n) => a.plus(n.rate).plus(n.extraCharge), D(0)).toFixed(2), nightly: nights.map((n) => ({ date: toDateOnlyString(n.date), rate: n.rate.toFixed(2), extra: n.extraCharge.toFixed(2), name: n.rateName })) });
    }
    const t = totalsFor(allNights, input.discount ?? 0, ctx.property);
    return {
      ok: true, nights: diffNights(checkIn, checkOut), types: typeInfo, lines,
      totals: { roomTotal: t.roomTotal.toFixed(2), extras: t.extrasTotal.toFixed(2), discount: t.discount.toFixed(2), serviceCharge: t.serviceCharge.toFixed(2), tax: t.tax.toFixed(2), grandTotal: t.grandTotal.toFixed(2) },
    };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

const guestSchema = z.object({
  firstName: zs.req("First name"), lastName: zs.req("Last name"), email: zs.email, phone: zs.str, nationality: zs.str, country: zs.str,
  address: zs.str, company: zs.str, emergencyContactName: zs.str, emergencyContactPhone: zs.str, idType: zs.str, idNumber: zs.str,
});

export async function createReservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("reservations.create", async (tx, ctx) => {
    const o = formObject(fd);
    const base = z.object({
      guestId: zs.str, source: z.enum(SOURCES), checkIn: zs.date, checkOut: zs.date, specialRequests: zs.text, notes: zs.text,
      companyName: zs.str, groupName: zs.str, discount: zs.money, status: z.enum(["PENDING", "CONFIRMED"]),
      depositAmount: zs.money, depositMethod: z.enum(METHODS), depositReference: zs.str, idempotencyKey: zs.req("Request key"),
      lines: z.string().transform((s) => JSON.parse(s) as unknown).pipe(z.array(z.object({ roomTypeId: z.string().min(1, "Choose a room type"), roomId: z.string().optional().nullable(), adults: z.number().int().min(1).max(20), children: z.number().int().min(0).max(20) })).min(1, "Add at least one room").max(50)),
    }).parse(o);
    if (base.discount > 0 && !ctx.user.isSuperAdmin && !ctx.permissions.has("reservations.override_rate")) throw new BusinessError("You are not allowed to give discounts.");
    const guest = base.guestId ? undefined : guestSchema.parse(o);
    if (base.depositAmount > 0 && !can(ctx, "frontdesk.payment") && !can(ctx, "reservations.create")) throw new BusinessError("You are not allowed to take payments.");
    const res = await createReservation(tx, ctx.actor, {
      guestId: base.guestId, guest, source: base.source, checkIn: base.checkIn, checkOut: base.checkOut, rooms: base.lines,
      specialRequests: base.specialRequests, notes: base.notes, companyName: base.companyName, groupName: base.groupName, discount: base.discount,
      status: base.status, idempotencyKey: base.idempotencyKey, today: ctx.today,
      deposit: base.depositAmount > 0 ? { amount: base.depositAmount, method: base.depositMethod, reference: base.depositReference } : null,
    });
    return { ok: true, message: `Reservation ${res.reference} created.`, redirectTo: `/reservations/${res.id}` };
  });
}

export async function updateReservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("reservations.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Reservation"), source: z.enum(SOURCES), specialRequests: zs.text, notes: zs.text, companyName: zs.str, groupName: zs.str, discount: zs.money, status: z.enum(["PENDING", "CONFIRMED"]).optional() }).parse(formObject(fd));
    const current = await tx.reservation.findUniqueOrThrow({ where: { id: d.id } });
    const discountChanged = !D(current.discountAmount).equals(d.discount);
    if (discountChanged && !can(ctx, "reservations.override_rate")) throw new BusinessError("You are not allowed to change discounts.");
    if (discountChanged && current.status === "CHECKED_IN") {
      const posted = await tx.folioTransaction.count({ where: { folio: { reservationId: d.id }, type: "DISCOUNT" } });
      if (posted) throw new BusinessError("The discount has already been posted to the folio.");
    }
    await updateReservationDetails(tx, ctx.actor, d.id, { ...d, discount: discountChanged ? d.discount : undefined, specialRequests: d.specialRequests ?? null, notes: d.notes ?? null, companyName: d.companyName ?? null, groupName: d.groupName ?? null });
    return { ok: true, message: "Reservation updated." };
  });
}

export async function changeDatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("reservations.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Reservation"), checkIn: zs.date, checkOut: zs.date }).parse(formObject(fd));
    const r = await changeStayDates(tx, ctx.actor, d.id, d.checkIn, d.checkOut, ctx.today);
    return { ok: true, message: `Dates updated. New total ${formatMoney(r.grandTotal, ctx.property.currency)}.` };
  });
}

export async function moveRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("reservations.edit", async (tx, ctx) => {
    const d = z.object({ lineId: zs.req("Room line"), roomId: zs.str, checkIn: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()), checkOut: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()) }).parse(formObject(fd));
    await moveRoomLine(tx, ctx.actor, { lineId: d.lineId, roomId: d.roomId ?? null, checkIn: d.checkIn, checkOut: d.checkOut, today: ctx.today, requireInspection: ctx.property.requireInspection });
    return { ok: true, message: "Room assignment updated." };
  });
}

/** Calendar drag-and-drop: same validation as the form. */
export async function calendarMoveAction(input: { lineId: string; roomId: string; checkIn: string; checkOut: string }): Promise<ActionState> {
  const fd = new FormData();
  Object.entries(input).forEach(([k, v]) => fd.set(k, v));
  return moveRoomAction(null, fd);
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("frontdesk.payment", async (tx, ctx) => {
    const d = z.object({ reservationId: zs.req("Reservation"), amount: zs.money.refine((v) => v > 0, "Amount must be greater than zero"), method: z.enum(METHODS), reference: zs.str, notes: zs.str, idempotencyKey: zs.req("Request key") }).parse(formObject(fd));
    const res = await tx.reservation.findFirstOrThrow({ where: { id: d.reservationId, propertyId: ctx.property.id }, include: { folio: true } });
    if (!res.folio || res.folio.status === "CLOSED") throw new BusinessError("This folio is closed.");
    if (["CANCELLED", "NO_SHOW"].includes(res.status)) throw new BusinessError("Payments cannot be taken on a cancelled reservation.");
    const kind = res.status === "PENDING" || res.status === "CONFIRMED" ? "DEPOSIT" : "SETTLEMENT";
    {
      // Guard against typos: never accept more than is (or will be) owed for the stay.
      const pays = await tx.payment.findMany({ where: { folioId: res.folio.id } });
      const paid = pays.reduce((a, p) => (p.kind === "REFUND" ? a.minus(p.amount) : a.plus(p.amount)), D(0));
      const bal = await tx.folioTransaction.aggregate({ where: { folioId: res.folio.id }, _sum: { amount: true } });
      const remaining = D(res.grandTotal).minus(paid);
      const owed = remaining.greaterThan(D(bal._sum.amount)) ? remaining : D(bal._sum.amount);
      if (D(d.amount).greaterThan(owed)) throw new BusinessError(`Amount exceeds what is owed (${owed.toFixed(2)}).`);
    }
    const p = await recordPayment(tx, ctx.actor, { folioId: res.folio.id, kind, method: d.method, amount: d.amount, reference: d.reference, notes: d.notes, idempotencyKey: d.idempotencyKey, date: ctx.today });
    await tx.reservationEvent.create({ data: { reservationId: res.id, type: "PAYMENT", description: `${kind === "DEPOSIT" ? "Deposit" : "Payment"} ${p.receiptNumber}: ${formatMoney(p.amount, ctx.property.currency)} by ${p.method.toLowerCase().replace("_", " ")}`, userId: ctx.user.id } });
    await tx.notification.create({ data: { propertyId: ctx.property.id, type: "PAYMENT_RECEIVED", title: `Payment received on ${res.reference}`, body: formatMoney(p.amount, ctx.property.currency), link: `/reservations/${res.id}` } });
    return { ok: true, message: `Payment recorded (receipt ${p.receiptNumber}).` };
  });
}

export async function cancelReservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("reservations.cancel", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Reservation"), reason: zs.req("Reason"), refundAmount: zs.money, refundMethod: z.enum(METHODS), noShow: zs.bool, idempotencyKey: zs.req("Request key") }).parse(formObject(fd));
    if (d.refundAmount > 0 && !can(ctx, "frontdesk.payment")) throw new BusinessError("You are not allowed to issue refunds.");
    await cancelReservation(tx, ctx.actor, { reservationId: d.id, reason: d.reason, refundAmount: d.refundAmount, refundMethod: d.refundMethod, idempotencyKey: d.idempotencyKey, today: ctx.today, noShow: d.noShow });
    return { ok: true, message: d.noShow ? "Marked as no-show." : "Reservation cancelled." };
  });
}

export async function searchGuestsAction(q: string) {
  const ctx = await requireProperty("guests.view");
  const term = q.trim();
  if (term.length < 2) return [];
  const guests = await prisma.guest.findMany({
    where: { propertyId: ctx.property.id, OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }] },
    take: 8, orderBy: { updatedAt: "desc" },
  });
  return guests.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`, email: g.email, phone: g.phone, isVip: g.isVip }));
}
