import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { chargeBreakdown, extraPersonCharge, rateForNight } from "@/server/services/pricing";
import { parseDateOnly } from "@/lib/dates";

const rate = (o: Partial<Prisma.RoomRateGetPayload<object>>) => ({
  id: "r", roomTypeId: "t", name: "R", kind: "SEASONAL", startDate: null, endDate: null, daysOfWeek: [], price: new Prisma.Decimal(0), priority: 0, isActive: true, createdAt: new Date(), ...o,
}) as Prisma.RoomRateGetPayload<object>;

describe("pricing", () => {
  it("uses weekend and seasonal rules by priority, else base", () => {
    const rt = { basePrice: new Prisma.Decimal(100) };
    const rates = [
      rate({ name: "Weekend", daysOfWeek: [5, 6], price: new Prisma.Decimal(130), priority: 10 }),
      rate({ name: "Summer", startDate: parseDateOnly("2026-07-01"), endDate: parseDateOnly("2026-08-31"), price: new Prisma.Decimal(150), priority: 20 }),
    ];
    expect(rateForNight(rt, rates, parseDateOnly("2026-11-04")).price.toNumber()).toBe(100); // Wednesday
    expect(rateForNight(rt, rates, parseDateOnly("2026-11-06")).price.toNumber()).toBe(130); // Friday
    expect(rateForNight(rt, rates, parseDateOnly("2026-07-03")).price.toNumber()).toBe(150); // Summer beats weekend
  });
  it("charges extra people beyond base occupancy", () => {
    const rt = { baseOccupancy: 2, extraAdultCharge: new Prisma.Decimal(25), extraChildCharge: new Prisma.Decimal(10) };
    expect(extraPersonCharge(rt, 2, 0).toNumber()).toBe(0);
    expect(extraPersonCharge(rt, 3, 1).toNumber()).toBe(35);
    expect(extraPersonCharge(rt, 1, 2).toNumber()).toBe(10);
  });
  it("computes service charge then tax with half-up rounding", () => {
    const b = chargeBreakdown(99.99, 5, 10);
    expect(b.service.toNumber()).toBe(5);
    expect(b.tax.toNumber()).toBe(10.5);
    expect(b.total.toNumber()).toBe(115.49);
  });
});
