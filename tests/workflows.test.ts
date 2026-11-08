import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { addDays } from "@/lib/dates";
import { createReservation, cancelReservation, changeStayDates } from "@/server/services/reservations";
import { checkIn, checkOut, nightAudit, walkIn } from "@/server/services/frontdesk";
import { changeHousekeepingStatus } from "@/server/services/rooms";
import { postJournal } from "@/server/services/ledger";
import { recordPayment } from "@/server/services/folio";
import { balances, prisma, resetDb, setupProperty, today } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupProperty>>;
const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn, { timeout: 20000 });
const guest = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

beforeEach(async () => {
  await resetDb();
  ctx = await setupProperty();
});
afterAll(() => prisma.$disconnect());

describe("availability", () => {
  it("prevents double booking of a specific room", async () => {
    const base = { guest, source: "DIRECT" as const, today, checkIn: today, checkOut: addDays(today, 2) };
    await tx((t) => createReservation(t, ctx.actor, { ...base, rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], idempotencyKey: "a" }));
    await expect(
      tx((t) => createReservation(t, ctx.actor, { ...base, checkIn: addDays(today, 1), checkOut: addDays(today, 3), rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], idempotencyKey: "b" })),
    ).rejects.toThrow(/not available/);
  });

  it("stops selling a room type once it is full, and allows back-to-back stays", async () => {
    const base = { guest, source: "DIRECT" as const, today, rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }] };
    await tx((t) => createReservation(t, ctx.actor, { ...base, checkIn: today, checkOut: addDays(today, 2), idempotencyKey: "1" }));
    await tx((t) => createReservation(t, ctx.actor, { ...base, checkIn: today, checkOut: addDays(today, 2), idempotencyKey: "2" }));
    await expect(tx((t) => createReservation(t, ctx.actor, { ...base, checkIn: addDays(today, 1), checkOut: addDays(today, 3), idempotencyKey: "3" }))).rejects.toThrow(/No Standard available/);
    await tx((t) => createReservation(t, ctx.actor, { ...base, checkIn: addDays(today, 2), checkOut: addDays(today, 3), idempotencyKey: "4" }));
  });

  it("the database exclusion constraint rejects overlapping assignments even if code is bypassed", async () => {
    const r = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 2), rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], idempotencyKey: "x" }));
    await expect(
      prisma.reservationRoom.create({ data: { reservationId: r.id, roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, checkIn: addDays(today, 1), checkOut: addDays(today, 4) } }),
    ).rejects.toThrow();
  });

  it("is idempotent for repeated booking submissions", async () => {
    const input = { guest, source: "DIRECT" as const, today, checkIn: today, checkOut: addDays(today, 1), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "same", deposit: { amount: 50, method: "CASH" as const } };
    const a = await tx((t) => createReservation(t, ctx.actor, input));
    const b = await tx((t) => createReservation(t, ctx.actor, input));
    expect(a.id).toBe(b.id);
    expect(await prisma.reservation.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe("guest stay end to end", () => {
  it("reservation → deposit → check-in → night audit → check-out posts balanced, correct books", async () => {
    const res = await tx((t) =>
      createReservation(t, ctx.actor, {
        guest, source: "PHONE", today, checkIn: today, checkOut: addDays(today, 2), discount: 20,
        rooms: [{ roomTypeId: ctx.std.id, adults: 3, children: 0 }], idempotencyKey: "r1", deposit: { amount: 100, method: "CARD" },
      }),
    );
    // 2 nights × (100 + 1 extra adult × 20) = 240; discount 20 → 220; svc 5% = 11; tax 10% of 231 = 23.10; total 254.10
    expect(Number(res.grandTotal)).toBeCloseTo(254.1, 2);
    let b = await balances(ctx.property.id);
    expect(b["1010"]).toBe(100);
    expect(b["2100"]).toBe(-100);

    const line = await prisma.reservationRoom.findFirstOrThrow({ where: { reservationId: res.id } });
    // Dirty rooms cannot be used.
    await prisma.room.update({ where: { id: ctx.rooms[0].id }, data: { housekeepingStatus: "DIRTY" } });
    await expect(
      tx((t) => checkIn(t, ctx.actor, { reservationId: res.id, lines: [{ lineId: line.id, roomId: ctx.rooms[0].id, adults: 3, children: 0 }], document: { type: "PASSPORT", number: "X1" }, documentVerified: true, idempotencyKey: "ci0", today })),
    ).rejects.toThrow(/not ready/);
    await tx((t) => checkIn(t, ctx.actor, { reservationId: res.id, lines: [{ lineId: line.id, roomId: ctx.rooms[1].id, adults: 3, children: 0 }], document: { type: "PASSPORT", number: "X1" }, documentVerified: true, idempotencyKey: "ci1", today }));
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ctx.rooms[1].id } })).occupancyStatus).toBe("OCCUPIED");

    expect(await tx((t) => nightAudit(t, ctx.actor, today))).toBe(1);
    expect(await tx((t) => nightAudit(t, ctx.actor, today))).toBe(0); // no duplicate posting

    // Check out on the departure date.
    const departure = addDays(today, 2);
    await expect(tx((t) => checkOut(t, ctx.actor, { reservationId: res.id, allowBalance: false, idempotencyKey: "co0", today: departure }))).rejects.toThrow(/still owes 154.10/);
    const inv = await tx((t) => checkOut(t, ctx.actor, { reservationId: res.id, allowBalance: false, idempotencyKey: "co1", today: departure, payment: { amount: 154.1, method: "CASH" } }));
    expect(Number(inv.total)).toBeCloseTo(254.1, 2);
    expect(Number(inv.balance)).toBe(0);

    b = await balances(ctx.property.id);
    expect(b["1100"]).toBe(0); // receivable settled
    expect(b["2100"]).toBe(0); // deposit applied
    expect(b["1000"] + b["1010"]).toBeCloseTo(254.1, 2);
    expect(-b["4000"]).toBe(240);
    expect(b["4900"]).toBe(20);
    expect(-b["2200"]).toBeCloseTo(23.1, 2);
    expect(Object.values(b).reduce((a, v) => a + v, 0)).toBeCloseTo(0, 6);

    const room = await prisma.room.findUniqueOrThrow({ where: { id: ctx.rooms[1].id } });
    expect(room.occupancyStatus).toBe("VACANT");
    expect(room.housekeepingStatus).toBe("DIRTY");
    expect(await prisma.housekeepingTask.count({ where: { roomId: room.id, type: "CHECKOUT_CLEAN" } })).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("CHECKED_OUT");

    // Housekeeping workflow returns the room to sale.
    for (const s of ["CLEANING_IN_PROGRESS", "CLEAN", "INSPECTED"] as const) await tx((t) => changeHousekeepingStatus(t, ctx.actor, room.id, s));
    expect((await prisma.housekeepingTask.findFirstOrThrow({ where: { roomId: room.id } })).status).toBe("INSPECTED");
  });

  it("early departure shortens the stay and only charges nights stayed", async () => {
    const res = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 4), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "e1" }));
    const line = await prisma.reservationRoom.findFirstOrThrow({ where: { reservationId: res.id } });
    await tx((t) => checkIn(t, ctx.actor, { reservationId: res.id, lines: [{ lineId: line.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], document: { type: "ID", number: "1" }, documentVerified: true, idempotencyKey: "eci", today }));
    const inv = await tx((t) => checkOut(t, ctx.actor, { reservationId: res.id, allowBalance: true, idempotencyKey: "eco", today: addDays(today, 1) }));
    expect(Number(inv.subtotal)).toBe(100);
    expect(Number(inv.balance)).toBeCloseTo(115.5, 2);
    expect((await balances(ctx.property.id))["1100"]).toBeCloseTo(115.5, 2); // left on guest ledger
  });

  it("walk-in creates the booking and checks in atomically", async () => {
    const res = await tx((t) => walkIn(t, ctx.actor, { guest, today, checkOut: addDays(today, 1), rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], roomId: ctx.rooms[0].id, document: { type: "ID", number: "9" }, documentVerified: true, idempotencyKey: "w1", deposit: { amount: 50, method: "CASH" } }));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("CHECKED_IN");
    expect((await balances(ctx.property.id))["1000"]).toBe(50);
  });
});

describe("changes and cancellations", () => {
  it("extension is refused when the room is taken", async () => {
    const a = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 2), rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], idempotencyKey: "c1" }));
    await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: addDays(today, 2), checkOut: addDays(today, 3), rooms: [{ roomTypeId: ctx.std.id, roomId: ctx.rooms[0].id, adults: 1, children: 0 }], idempotencyKey: "c2" }));
    await expect(tx((t) => changeStayDates(t, ctx.actor, a.id, today, addDays(today, 3), today))).rejects.toThrow(/not available/);
    const updated = await tx((t) => changeStayDates(t, ctx.actor, a.id, today, addDays(today, 1), today));
    expect(Number(updated.roomTotal)).toBe(100);
  });

  it("cancellation refunds part of the deposit and keeps the rest as revenue", async () => {
    const r = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: addDays(today, 5), checkOut: addDays(today, 6), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "k1", deposit: { amount: 80, method: "CARD" } }));
    await expect(tx((t) => cancelReservation(t, ctx.actor, { reservationId: r.id, reason: "x", refundAmount: 100, refundMethod: "CARD", idempotencyKey: "k2", today }))).rejects.toThrow(/Refund must be/);
    await tx((t) => cancelReservation(t, ctx.actor, { reservationId: r.id, reason: "Plans changed", refundAmount: 50, refundMethod: "CARD", idempotencyKey: "k3", today }));
    const b = await balances(ctx.property.id);
    expect(b["2100"]).toBe(0);
    expect(b["1100"]).toBe(0);
    expect(b["1010"]).toBe(30);
    expect(b["4000"]).toBe(-30);
    expect((await prisma.reservationRoom.findFirstOrThrow({ where: { reservationId: r.id } })).status).toBe("CANCELLED");
  });
});

describe("ledger integrity", () => {
  it("rejects unbalanced entries and duplicate sources", async () => {
    await expect(tx((t) => postJournal(t, ctx.actor, { date: today, memo: "bad", sourceType: "MANUAL", sourceId: "1", lines: [{ account: "1000", debit: 10 }, { account: "4000", credit: 9 }] }))).rejects.toThrow(/Unbalanced/);
    const a = await tx((t) => postJournal(t, ctx.actor, { date: today, memo: "ok", sourceType: "MANUAL", sourceId: "2", lines: [{ account: "1000", debit: 10 }, { account: "4000", credit: 10 }] }));
    const b = await tx((t) => postJournal(t, ctx.actor, { date: today, memo: "ok", sourceType: "MANUAL", sourceId: "2", lines: [{ account: "1000", debit: 10 }, { account: "4000", credit: 10 }] }));
    expect(a.id).toBe(b.id);
  });

  it("database forbids editing or deleting posted lines, and rejects unbalanced raw inserts", async () => {
    const e = await tx((t) => postJournal(t, ctx.actor, { date: today, memo: "ok", sourceType: "MANUAL", sourceId: "3", lines: [{ account: "1000", debit: 10 }, { account: "4000", credit: 10 }] }));
    await expect(prisma.journalLine.updateMany({ where: { entryId: e.id }, data: { memo: "edit" } })).rejects.toThrow(/cannot be updated/);
    await expect(prisma.journalLine.deleteMany({ where: { entryId: e.id } })).rejects.toThrow(/cannot be updated or deleted/);
    const acc = await prisma.account.findFirstOrThrow({ where: { propertyId: ctx.property.id, code: "1000" } });
    await expect(
      prisma.$transaction(async (t) => {
        const je = await t.journalEntry.create({ data: { propertyId: ctx.property.id, number: "X", date: today, memo: "raw", sourceType: "RAW", sourceId: "1" } });
        await t.journalLine.create({ data: { entryId: je.id, accountId: acc.id, debit: 5 } });
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it("payments are idempotent", async () => {
    const r = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 1), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "p" }));
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: r.id } });
    for (let i = 0; i < 2; i++) await tx((t) => recordPayment(t, ctx.actor, { folioId: folio.id, kind: "DEPOSIT", method: "CASH", amount: 20, idempotencyKey: "pay-1", date: today }));
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe("room moves", () => {
  it("assigning a room of another type keeps the booked rate and counts inventory correctly", async () => {
    const suite = await prisma.roomType.create({ data: { propertyId: ctx.property.id, code: "STE", name: "Suite", basePrice: 300, maxOccupancy: 2, maxAdults: 2 } });
    const sroom = await prisma.room.create({ data: { propertyId: ctx.property.id, roomTypeId: suite.id, number: "301", floor: 3 } });
    const r = await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 2), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "m1" }));
    const line = await prisma.reservationRoom.findFirstOrThrow({ where: { reservationId: r.id } });
    const { moveRoomLine } = await import("@/server/services/reservations");
    await tx((t) => moveRoomLine(t, ctx.actor, { lineId: line.id, roomId: sroom.id, today }));
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(after.roomTotal)).toBe(200); // booked Standard rate kept
    // Suite is now sold out; both standards still free.
    await expect(tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 1), rooms: [{ roomTypeId: suite.id, adults: 1, children: 0 }], idempotencyKey: "m2" }))).rejects.toThrow(/No Suite/);
    await tx((t) => createReservation(t, ctx.actor, { guest, source: "DIRECT", today, checkIn: today, checkOut: addDays(today, 1), rooms: [{ roomTypeId: ctx.std.id, adults: 1, children: 0 }, { roomTypeId: ctx.std.id, adults: 1, children: 0 }], idempotencyKey: "m3" }));
    // Extending the upgraded stay still works.
    await tx((t) => changeStayDates(t, ctx.actor, r.id, today, addDays(today, 3), today));
  });
});
