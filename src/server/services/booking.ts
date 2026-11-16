import type { Tx } from "@/lib/db";
import { diffNights } from "@/lib/dates";
import { D, sum } from "@/lib/money";
import { typeAvailability } from "./availability";
import { quoteNights, totalsFor } from "./pricing";
import { createReservation } from "./reservations";
import { evaluateCoupon, useCoupon } from "./crm";
import { BusinessError, assert, notify, type Actor } from "./common";

export const MAX_ONLINE_NIGHTS = 30;

/** Public booking engine: every sellable room type with live availability and an exact price for the stay. */
export async function searchStay(db: Tx, propertyId: string, q: { checkIn: Date; checkOut: Date; adults: number; children: number; promo?: string | null; today: Date }) {
  assert(q.checkIn >= q.today, "Arrival cannot be in the past.");
  assert(q.checkOut > q.checkIn, "Departure must be after arrival.");
  assert(diffNights(q.checkIn, q.checkOut) <= MAX_ONLINE_NIGHTS, `Online bookings are limited to ${MAX_ONLINE_NIGHTS} nights. Please contact the hotel.`);
  const property = await db.property.findUniqueOrThrow({ where: { id: propertyId } });
  const types = await db.roomType.findMany({ where: { propertyId, isActive: true }, include: { rates: true }, orderBy: { basePrice: "asc" } });
  let promoError: string | null = null;
  const out = [];
  for (const rt of types) {
    const free = await typeAvailability(db, propertyId, rt.id, q.checkIn, q.checkOut, { today: q.today });
    let nights;
    try { nights = quoteNights(rt, q.checkIn, q.checkOut, q.adults, q.children); } catch (e) {
      out.push({ rt, free, fits: false, reason: e instanceof BusinessError ? e.message : "Not available", totals: null, discount: D(0), couponId: null as string | null });
      continue;
    }
    const gross = sum(nights.map((n) => D(n.rate).plus(n.extraCharge)));
    let discount = D(0);
    let couponId: string | null = null;
    if (q.promo) {
      try { const c = await evaluateCoupon(db, propertyId, { code: q.promo, checkIn: q.checkIn, checkOut: q.checkOut, roomTotal: gross }); discount = c.discount; couponId = c.coupon.id; }
      catch (e) { promoError = e instanceof BusinessError ? e.message : "That promo code is not valid."; }
    }
    out.push({ rt, free, fits: true, reason: null, totals: totalsFor(nights, discount, property), discount, couponId, nightly: gross.dividedBy(nights.length) });
  }
  return { property, results: out, promoError };
}

export async function bookOnline(
  tx: Tx,
  propertyId: string,
  input: { roomTypeId: string; checkIn: Date; checkOut: Date; adults: number; children: number; promo?: string | null; firstName: string; lastName: string; email: string; phone: string; country?: string | null; specialRequests?: string | null; marketingConsent: boolean; idempotencyKey: string; today: Date },
) {
  const property = await tx.property.findFirst({ where: { id: propertyId, isActive: true, bookingEngineEnabled: true } });
  assert(property, "Online booking is not available for this hotel.");
  assert(diffNights(input.checkIn, input.checkOut) <= MAX_ONLINE_NIGHTS, `Online bookings are limited to ${MAX_ONLINE_NIGHTS} nights.`);
  const actor: Actor = { userId: null, propertyId };
  const rt = await tx.roomType.findFirst({ where: { id: input.roomTypeId, propertyId, isActive: true }, include: { rates: true } });
  assert(rt, "That room type is no longer offered.");
  const nights = quoteNights(rt, input.checkIn, input.checkOut, input.adults, input.children);
  const gross = sum(nights.map((n) => D(n.rate).plus(n.extraCharge)));
  let discount = D(0);
  let couponId: string | null = null;
  if (input.promo) {
    const c = await evaluateCoupon(tx, propertyId, { code: input.promo, checkIn: input.checkIn, checkOut: input.checkOut, roomTotal: gross });
    discount = c.discount; couponId = c.coupon.id;
  }
  const res = await createReservation(tx, actor, {
    source: "WEBSITE", status: "PENDING", checkIn: input.checkIn, checkOut: input.checkOut,
    rooms: [{ roomTypeId: rt.id, adults: input.adults, children: input.children }],
    guest: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, country: input.country ?? null },
    specialRequests: input.specialRequests ?? null, discount, notes: input.promo ? `Online booking with promo code ${input.promo.toUpperCase()}` : "Online booking",
    idempotencyKey: `web:${input.idempotencyKey}`, today: input.today,
  });
  if (couponId) await useCoupon(tx, couponId);
  if (input.marketingConsent) await tx.guest.update({ where: { id: res.guestId }, data: { marketingConsent: true } });
  await notify(tx, propertyId, { type: "ONLINE_BOOKING", title: `Online booking ${res.reference} awaits confirmation`, link: `/reservations/${res.id}` });
  return res;
}
