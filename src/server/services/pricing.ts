import { Prisma, type RoomRate, type RoomType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, pct, round2, sum } from "@/lib/money";
import { eachNight } from "@/lib/dates";
import { BusinessError } from "./common";

export type NightQuote = { date: Date; rate: Prisma.Decimal; extraCharge: Prisma.Decimal; rateName: string };

/** Pick the rate for one night: highest-priority matching rule, else the room type's base price. */
export function rateForNight(roomType: Pick<RoomType, "basePrice">, rates: RoomRate[], date: Date) {
  const dow = date.getUTCDay();
  const matches = rates.filter(
    (r) =>
      r.isActive &&
      (!r.startDate || r.startDate <= date) &&
      (!r.endDate || r.endDate >= date) &&
      (r.daysOfWeek.length === 0 || r.daysOfWeek.includes(dow)),
  );
  matches.sort((a, b) => b.priority - a.priority || b.createdAt.getTime() - a.createdAt.getTime());
  const best = matches[0];
  return best ? { price: D(best.price), name: best.name } : { price: D(roomType.basePrice), name: "Base rate" };
}

export function extraPersonCharge(
  rt: Pick<RoomType, "baseOccupancy" | "extraAdultCharge" | "extraChildCharge">,
  adults: number,
  children: number,
) {
  const extraAdults = Math.max(0, adults - rt.baseOccupancy);
  const freeSlotsForChildren = Math.max(0, rt.baseOccupancy - adults);
  const extraChildren = Math.max(0, children - freeSlotsForChildren);
  return round2(D(rt.extraAdultCharge).times(extraAdults).plus(D(rt.extraChildCharge).times(extraChildren)));
}

export function validateOccupancy(rt: Pick<RoomType, "name" | "maxOccupancy" | "maxAdults" | "maxChildren">, adults: number, children: number) {
  if (adults < 1) throw new BusinessError("At least one adult is required per room.");
  if (adults > rt.maxAdults) throw new BusinessError(`${rt.name} allows at most ${rt.maxAdults} adults.`);
  if (children > rt.maxChildren) throw new BusinessError(`${rt.name} allows at most ${rt.maxChildren} children.`);
  if (adults + children > rt.maxOccupancy) throw new BusinessError(`${rt.name} allows at most ${rt.maxOccupancy} guests.`);
}

export function quoteNights(
  rt: RoomType & { rates: RoomRate[] },
  checkIn: Date,
  checkOut: Date,
  adults: number,
  children: number,
): NightQuote[] {
  validateOccupancy(rt, adults, children);
  const extra = extraPersonCharge(rt, adults, children);
  return eachNight(checkIn, checkOut).map((date) => {
    const r = rateForNight(rt, rt.rates, date);
    return { date, rate: r.price, extraCharge: extra, rateName: r.name };
  });
}

/** Service charge and tax on a gross amount. Same rounding is used when posting, so quotes match invoices. */
export function chargeBreakdown(amount: Prisma.Decimal.Value, serviceRate: Prisma.Decimal.Value, taxRate: Prisma.Decimal.Value) {
  const base = round2(amount);
  const service = pct(base, serviceRate);
  const tax = pct(base.plus(service), taxRate);
  return { base, service, tax, total: base.plus(service).plus(tax) };
}

export function totalsFor(
  nights: { rate: Prisma.Decimal.Value; extraCharge: Prisma.Decimal.Value }[],
  discount: Prisma.Decimal.Value,
  property: { serviceChargeRate: Prisma.Decimal.Value; taxRate: Prisma.Decimal.Value },
) {
  let roomTotal = ZERO, extras = ZERO, service = ZERO, tax = ZERO;
  for (const n of nights) {
    const b = chargeBreakdown(D(n.rate).plus(D(n.extraCharge)), property.serviceChargeRate, property.taxRate);
    roomTotal = roomTotal.plus(D(n.rate));
    extras = extras.plus(D(n.extraCharge));
    service = service.plus(b.service);
    tax = tax.plus(b.tax);
  }
  const disc = discountBreakdown(discount, property);
  return {
    roomTotal,
    extrasTotal: extras,
    discount: disc.base,
    serviceCharge: service.minus(disc.service),
    tax: tax.minus(disc.tax),
    grandTotal: sum([roomTotal, extras, service, tax]).minus(disc.total),
  };
}

/** A discount reduces the base, and with it the service charge and tax that were levied on it. */
export function discountBreakdown(discount: Prisma.Decimal.Value, property: { serviceChargeRate: Prisma.Decimal.Value; taxRate: Prisma.Decimal.Value }) {
  return chargeBreakdown(discount, property.serviceChargeRate, property.taxRate);
}

export async function loadRoomType(tx: Tx, propertyId: string, roomTypeId: string) {
  const rt = await tx.roomType.findFirst({ where: { id: roomTypeId, propertyId, isActive: true }, include: { rates: true } });
  if (!rt) throw new BusinessError("Room type not found.");
  return rt;
}
