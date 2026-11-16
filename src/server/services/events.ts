import type { PaymentMethod } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, round2 } from "@/lib/money";
import { applyDeposits, folioBalance, generateInvoice, openFolio, postCharge, recordPayment, unappliedDeposits } from "./folio";
import { assert, audit, lockProperty, nextNumber, notify, pad, type Actor } from "./common";

export const EVENT_TYPES = ["CONFERENCE", "MEETING", "WEDDING", "BANQUET", "PARTY", "OTHER"] as const;

async function load(tx: Tx, actor: Actor, id: string) {
  const e = await tx.eventBooking.findFirst({ where: { id, propertyId: actor.propertyId }, include: { venue: true, items: true, folio: true } });
  assert(e, "Event not found.");
  return e;
}

export async function createEvent(
  tx: Tx,
  actor: Actor,
  input: {
    venueId: string; title: string; eventType: string; clientName: string; company?: string | null; email?: string | null; phone?: string | null;
    date: Date; startMinute: number; endMinute: number; attendees: number; notes?: string | null; confirmed: boolean; today: Date;
  },
) {
  const venue = await tx.eventVenue.findFirst({ where: { id: input.venueId, propertyId: actor.propertyId, isActive: true } });
  assert(venue, "Choose a venue.");
  assert(input.date >= input.today, "The event date cannot be in the past.");
  assert(input.endMinute > input.startMinute, "The event must end after it starts.");
  assert(input.attendees >= 1, "Enter the number of attendees.");
  assert(input.attendees <= venue.capacity, `${venue.name} holds at most ${venue.capacity} people.`);
  await lockProperty(tx, actor.propertyId, `venue:${venue.id}`);
  const clash = await tx.eventBooking.findFirst({
    where: { venueId: venue.id, date: input.date, status: { in: ["TENTATIVE", "CONFIRMED"] }, startMinute: { lt: input.endMinute }, endMinute: { gt: input.startMinute } },
  });
  assert(!clash, `${venue.name} is already booked then (${clash?.number} ${clash?.title}).`);
  const folio = await openFolio(tx, actor, null);
  const n = await nextNumber(tx, actor.propertyId, "EVT");
  const hours = D(input.endMinute - input.startMinute).dividedBy(60);
  const e = await tx.eventBooking.create({
    data: {
      propertyId: actor.propertyId, number: `EVT-${pad(n, 5)}`, venueId: venue.id, title: input.title, eventType: input.eventType, clientName: input.clientName,
      company: input.company || null, email: input.email || null, phone: input.phone || null, date: input.date, startMinute: input.startMinute, endMinute: input.endMinute,
      attendees: input.attendees, notes: input.notes || null, status: input.confirmed ? "CONFIRMED" : "TENTATIVE", folioId: folio.id, createdById: actor.userId,
      items: D(venue.hourlyRate).greaterThan(0)
        ? { create: { description: `${venue.name} hire (${hours.toString()} h)`, quantity: hours, unitPrice: venue.hourlyRate, amount: round2(hours.times(venue.hourlyRate)), revenueAccount: "4300" } }
        : undefined,
    },
  });
  await audit(tx, actor, "event.create", "EventBooking", e.id, `${e.number} ${e.title} at ${venue.name}`);
  await notify(tx, actor.propertyId, { type: "EVENT", title: `New event ${e.number}: ${e.title}`, link: `/events/${e.id}` });
  return e;
}

export async function addEventItem(tx: Tx, actor: Actor, input: { eventId: string; description: string; quantity: number; unitPrice: number; revenueAccount: string }) {
  const e = await load(tx, actor, input.eventId);
  assert(["TENTATIVE", "CONFIRMED"].includes(e.status), "This event is closed.");
  assert(input.quantity > 0, "Quantity must be greater than zero.");
  await tx.eventItem.create({ data: { eventId: e.id, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, amount: round2(D(input.quantity).times(input.unitPrice)), revenueAccount: input.revenueAccount } });
}

export async function removeEventItem(tx: Tx, actor: Actor, itemId: string) {
  const item = await tx.eventItem.findUniqueOrThrow({ where: { id: itemId } });
  const e = await load(tx, actor, item.eventId);
  assert(["TENTATIVE", "CONFIRMED"].includes(e.status) && !item.postedAt, "Posted items cannot be removed.");
  await tx.eventItem.delete({ where: { id: itemId } });
}

export async function confirmEvent(tx: Tx, actor: Actor, id: string) {
  const e = await load(tx, actor, id);
  assert(e.status === "TENTATIVE", "Only tentative events can be confirmed.");
  await tx.eventBooking.update({ where: { id }, data: { status: "CONFIRMED" } });
  await audit(tx, actor, "event.confirm", "EventBooking", id, `Confirmed ${e.number}`);
}

export async function eventDeposit(tx: Tx, actor: Actor, input: { eventId: string; amount: number; method: PaymentMethod; reference?: string | null; idempotencyKey: string; today: Date }) {
  const e = await load(tx, actor, input.eventId);
  assert(["TENTATIVE", "CONFIRMED"].includes(e.status), "Deposits are taken before the event is completed.");
  return recordPayment(tx, actor, { folioId: e.folioId, kind: "DEPOSIT", method: input.method, amount: input.amount, reference: input.reference, idempotencyKey: input.idempotencyKey, date: input.today });
}

/** Complete: every item is charged to the event folio, deposits are applied, and the invoice is issued. */
export async function completeEvent(tx: Tx, actor: Actor, id: string, today: Date) {
  const e = await load(tx, actor, id);
  assert(e.status === "CONFIRMED", "Confirm the event before completing it.");
  assert(e.date <= today, "An event can be completed on or after its date.");
  assert(e.items.length > 0, "Add at least one item to bill.");
  for (const item of e.items.filter((i) => !i.postedAt)) {
    await postCharge(tx, actor, { folioId: e.folioId, type: "SERVICE", description: `${e.number} ${item.description}`, amount: item.amount, serviceDate: today, revenueAccount: item.revenueAccount, sourceType: "EVENT_ITEM", sourceId: item.id });
    await tx.eventItem.update({ where: { id: item.id }, data: { postedAt: new Date() } });
  }
  await applyDeposits(tx, actor, e.folioId, today);
  const inv = await generateInvoice(tx, actor, e.folioId, `${e.clientName}${e.company ? `, ${e.company}` : ""}`);
  const balance = await folioBalance(tx, e.folioId);
  await tx.eventBooking.update({ where: { id }, data: { status: "COMPLETED", invoiceId: inv.id } });
  if (balance.isZero()) await tx.folio.update({ where: { id: e.folioId }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit(tx, actor, "event.complete", "EventBooking", id, `Completed ${e.number}, invoice ${inv.number}`);
  return inv;
}

/** Collect the remaining balance after the event (Dr Cash / Cr AR); refunds any overpayment. */
export async function settleEvent(tx: Tx, actor: Actor, input: { eventId: string; amount: number; method: PaymentMethod; reference?: string | null; idempotencyKey: string; today: Date }) {
  const e = await load(tx, actor, input.eventId);
  assert(e.status === "COMPLETED", "Complete the event first.");
  const due = await folioBalance(tx, e.folioId);
  assert(D(input.amount).lessThanOrEqualTo(due), `Only ${due.toFixed(2)} is due.`);
  await recordPayment(tx, actor, { folioId: e.folioId, kind: "SETTLEMENT", method: input.method, amount: input.amount, reference: input.reference, idempotencyKey: input.idempotencyKey, date: input.today });
  if ((await folioBalance(tx, e.folioId)).isZero()) await tx.folio.update({ where: { id: e.folioId }, data: { status: "CLOSED", closedAt: new Date() } });
}

export async function cancelEvent(tx: Tx, actor: Actor, input: { eventId: string; reason: string; refundMethod?: PaymentMethod | null; idempotencyKey: string; today: Date }) {
  const e = await load(tx, actor, input.eventId);
  assert(["TENTATIVE", "CONFIRMED"].includes(e.status), "This event cannot be cancelled.");
  const held = await unappliedDeposits(tx, e.folioId);
  if (held.greaterThan(0)) {
    assert(input.refundMethod, `Choose how to refund the ${held.toFixed(2)} deposit.`);
    await recordPayment(tx, actor, { folioId: e.folioId, kind: "REFUND", refundOf: "DEPOSIT", method: input.refundMethod, amount: held, idempotencyKey: input.idempotencyKey, date: input.today, notes: `Event cancelled: ${input.reason}` });
  }
  await tx.eventBooking.update({ where: { id: e.id }, data: { status: "CANCELLED", notes: [e.notes, `Cancelled: ${input.reason}`].filter(Boolean).join("\n") } });
  await tx.folio.update({ where: { id: e.folioId }, data: { status: "CLOSED", closedAt: new Date() } });
  await audit(tx, actor, "event.cancel", "EventBooking", e.id, `Cancelled ${e.number}: ${input.reason}`);
}
