"use server";

import { z } from "zod";
import { formatMoney } from "@/lib/money";
import { can } from "@/server/auth/context";
import { checkIn, checkOut, nightAudit, walkIn } from "@/server/services/frontdesk";
import { BusinessError } from "@/server/services/common";
import { formObject, mutate, zs } from "./util";
import type { ActionState } from "./types";

const METHODS = ["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "CHEQUE", "ONLINE"] as const;

export async function checkInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("frontdesk.checkin", async (tx, ctx) => {
    const o = formObject(fd);
    const d = z.object({
      reservationId: zs.req("Reservation"), documentVerified: zs.bool, docType: zs.str, docNumber: zs.str, docCountry: zs.str,
      docExpiry: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()), specialRequests: zs.text,
      paymentAmount: zs.money, paymentMethod: z.enum(METHODS), paymentReference: zs.str, idempotencyKey: zs.req("Request key"),
    }).parse(o);
    const lineIds = fd.getAll("lineId").map(String);
    const lines = lineIds.filter((id) => fd.get(`include_${id}`) === "on").map((id) => ({
      lineId: id, roomId: String(fd.get(`room_${id}`) ?? ""), adults: Number(fd.get(`adults_${id}`) ?? 1), children: Number(fd.get(`children_${id}`) ?? 0),
    }));
    if (lines.some((l) => !l.roomId)) throw new BusinessError("Assign a ready room to every room being checked in.");
    if (d.paymentAmount > 0 && !can(ctx, "frontdesk.payment")) throw new BusinessError("You are not allowed to take payments.");
    await checkIn(tx, ctx.actor, {
      reservationId: d.reservationId, lines, documentVerified: d.documentVerified,
      document: d.docType && d.docNumber ? { type: d.docType, number: d.docNumber, issuingCountry: d.docCountry ?? null, expiryDate: d.docExpiry ?? null } : null,
      specialRequests: d.specialRequests ?? null, idempotencyKey: d.idempotencyKey, today: ctx.today,
      payment: d.paymentAmount > 0 ? { amount: d.paymentAmount, method: d.paymentMethod, reference: d.paymentReference } : null,
    });
    return { ok: true, message: "Guest checked in.", redirectTo: `/frontdesk/checkin/${d.reservationId}/receipt` };
  });
}

export async function checkOutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("frontdesk.checkout", async (tx, ctx) => {
    const d = z.object({ reservationId: zs.req("Reservation"), paymentAmount: zs.money, paymentMethod: z.enum(METHODS), paymentReference: zs.str, allowBalance: zs.bool, idempotencyKey: zs.req("Request key") }).parse(formObject(fd));
    if (d.allowBalance && !can(ctx, "frontdesk.allow_balance")) throw new BusinessError("You are not allowed to check out a guest with an unpaid balance.");
    if (d.paymentAmount > 0 && !can(ctx, "frontdesk.payment")) throw new BusinessError("You are not allowed to take payments.");
    const inv = await checkOut(tx, ctx.actor, {
      reservationId: d.reservationId, allowBalance: d.allowBalance, idempotencyKey: d.idempotencyKey, today: ctx.today,
      payment: d.paymentAmount > 0 ? { amount: d.paymentAmount, method: d.paymentMethod, reference: d.paymentReference } : null,
    });
    return { ok: true, message: `Checked out. Invoice ${inv.number} for ${formatMoney(inv.total, ctx.property.currency)}.`, redirectTo: `/invoices/${inv.id}` };
  });
}

export async function walkInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(["frontdesk.checkin", "reservations.create"], async (tx, ctx) => {
    const o = formObject(fd);
    const d = z.object({
      guestId: zs.str, checkOut: zs.date, roomId: zs.req("Room"), docType: zs.req("ID type"), docNumber: zs.req("ID number"), documentVerified: zs.bool,
      specialRequests: zs.text, notes: zs.text, companyName: zs.str, discount: zs.money, depositAmount: zs.money, depositMethod: z.enum(METHODS), depositReference: zs.str, idempotencyKey: zs.req("Request key"),
      lines: z.string().transform((s) => JSON.parse(s) as unknown).pipe(z.array(z.object({ roomTypeId: z.string().min(1), roomId: z.string().nullable().optional(), adults: z.number().int().min(1), children: z.number().int().min(0) })).length(1, "A walk-in is for one room")),
    }).parse(o);
    if (d.discount > 0 && !can(ctx, "reservations.override_rate")) throw new BusinessError("You are not allowed to give discounts.");
    const guest = d.guestId ? undefined : z.object({ firstName: zs.req("First name"), lastName: zs.req("Last name"), email: zs.email, phone: zs.str, nationality: zs.str, country: zs.str, address: zs.str, emergencyContactName: zs.str, emergencyContactPhone: zs.str }).parse(o);
    const res = await walkIn(tx, ctx.actor, {
      guestId: d.guestId, guest, checkOut: d.checkOut, rooms: d.lines.map((l) => ({ ...l, roomId: d.roomId })), roomId: d.roomId, today: ctx.today,
      document: { type: d.docType, number: d.docNumber }, documentVerified: d.documentVerified, specialRequests: d.specialRequests, notes: d.notes, companyName: d.companyName,
      discount: d.discount, idempotencyKey: d.idempotencyKey,
      deposit: d.depositAmount > 0 ? { amount: d.depositAmount, method: d.depositMethod, reference: d.depositReference } : null,
    });
    return { ok: true, message: `Walk-in ${res.reference} checked in.`, redirectTo: `/frontdesk/checkin/${res.id}/receipt` };
  });
}

export async function nightAuditAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return mutate("frontdesk.night_audit", async (tx, ctx) => {
    const n = await nightAudit(tx, ctx.actor, ctx.today);
    return { ok: true, message: n ? `Posted ${n} room night(s) to guest folios and the ledger.` : "Nothing to post: every in-house night up to today is already charged." };
  });
}
