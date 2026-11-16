import { Prisma, type PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { ACC, cashAccountFor, postJournal } from "./ledger";
import { chargeBreakdown } from "./pricing";
import { ZERO, round2 } from "@/lib/money";
import { BusinessError, assert, type Actor } from "./common";
import { postCharge } from "./folio";
import type { FolioTxnType } from "@prisma/client";

/**
 * A sale paid on the spot (not charged to a room).
 * Ledger: Dr Cash/Bank (total) / Cr revenue (base), Cr Service Charge Revenue, Cr Taxes Payable.
 */
export async function postDirectSale(
  tx: Tx,
  actor: Actor,
  input: { amount: Prisma.Decimal.Value; method: PaymentMethod; revenueAccount: string; memo: string; sourceType: string; sourceId: string; date: Date; applyServiceAndTax?: boolean },
) {
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId }, select: { serviceChargeRate: true, taxRate: true } });
  const b = input.applyServiceAndTax === false
    ? { base: round2(input.amount), service: ZERO, tax: ZERO, total: round2(input.amount) }
    : chargeBreakdown(input.amount, p.serviceChargeRate, p.taxRate);
  assert(b.base.greaterThan(0), "Amount must be greater than zero.");
  const entry = await postJournal(tx, actor, {
    date: input.date, memo: input.memo, sourceType: input.sourceType, sourceId: input.sourceId,
    lines: [
      { account: cashAccountFor(input.method), debit: b.total },
      { account: input.revenueAccount, credit: b.base },
      { account: ACC.SERVICE_CHARGE_REVENUE, credit: b.service },
      { account: ACC.TAXES_PAYABLE, credit: b.tax },
    ],
  });
  return { entry, breakdown: b };
}

/** The in-house reservation occupying a room, with its open folio. */
export async function inHouseByRoom(tx: Tx, propertyId: string, roomNumber: string) {
  const line = await tx.reservationRoom.findFirst({
    where: { status: "CHECKED_IN", room: { propertyId, number: roomNumber.trim() } },
    include: { reservation: { include: { folio: true, guest: true } }, room: true },
  });
  if (!line || !line.reservation.folio) throw new BusinessError(`No guest is checked in to room ${roomNumber}.`);
  return line;
}

export async function inHouseReservation(tx: Tx, propertyId: string, reservationId: string) {
  const res = await tx.reservation.findFirst({ where: { id: reservationId, propertyId, status: "CHECKED_IN" }, include: { folio: true, guest: true, rooms: { include: { room: true } } } });
  if (!res || !res.folio) throw new BusinessError("That guest is not checked in, so the charge cannot go to their room.");
  return res;
}

/** Charge a sale to an in-house guest's folio (service charge and tax added by the folio service). */
export async function chargeToRoom(
  tx: Tx,
  actor: Actor,
  input: { reservationId: string; type: FolioTxnType; description: string; amount: Prisma.Decimal.Value; revenueAccount: string; sourceType: string; sourceId: string; date: Date },
) {
  const res = await inHouseReservation(tx, actor.propertyId, input.reservationId);
  const txn = await postCharge(tx, actor, { folioId: res.folio!.id, type: input.type, description: input.description, amount: input.amount, serviceDate: input.date, revenueAccount: input.revenueAccount, sourceType: input.sourceType, sourceId: input.sourceId });
  return { res, txn };
}

/** Guests currently in house, for "charge to room" pickers. */
export async function inHouseGuests(tx: Tx, propertyId: string) {
  const lines = await tx.reservationRoom.findMany({
    where: { status: "CHECKED_IN", reservation: { propertyId } },
    include: { room: true, reservation: { include: { guest: true } } },
    orderBy: { room: { number: "asc" } },
  });
  return lines.map((l) => ({ reservationId: l.reservationId, label: `${l.room?.number ?? "—"} · ${l.reservation.guest.firstName} ${l.reservation.guest.lastName}`, room: l.room?.number ?? "", guest: `${l.reservation.guest.firstName} ${l.reservation.guest.lastName}` }));
}
