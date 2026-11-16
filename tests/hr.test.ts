import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { parseDateOnly } from "@/lib/dates";
import { computeAttendance, recordAttendance, requestLeave, decideLeave, cancelLeave, selfClock } from "@/server/services/hr";
import { approvePayrollRun, createPayrollRun, monthPeriod, payPayrollRun, updatePayrollItem } from "@/server/services/payroll";
import { balances, prisma, resetDb, setupProperty } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupProperty>>;
const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn, { timeout: 20000 });
const d = parseDateOnly;
const shift = { startMinute: 9 * 60, endMinute: 17 * 60, breakMinutes: 60 };

async function employee(over: Partial<Prisma.EmployeeUncheckedCreateInput> = {}) {
  return prisma.employee.create({
    data: { propertyId: ctx.property.id, employeeNo: `E${Math.random().toString(36).slice(2, 8)}`, firstName: "Sam", lastName: "Lee", jobTitle: "Clerk", hireDate: d("2026-01-01"), baseSalary: 3000, ...over },
  });
}
const leaveType = (code: string) => prisma.leaveType.findFirstOrThrow({ where: { propertyId: ctx.property.id, code } });

beforeEach(async () => {
  await resetDb();
  ctx = await setupProperty();
});
afterAll(() => prisma.$disconnect());

describe("attendance rules", () => {
  it("flags late arrival after the grace period and counts overtime beyond the shift", () => {
    expect(computeAttendance(shift, 9 * 60 + 5, 17 * 60)).toMatchObject({ status: "PRESENT", late: 5, worked: 7 * 60 - 5, overtime: 0 });
    expect(computeAttendance(shift, 9 * 60 + 20, 19 * 60)).toMatchObject({ status: "LATE", late: 20, worked: 8 * 60 + 40, overtime: 100 });
    expect(computeAttendance(shift, 9 * 60, 12 * 60)).toMatchObject({ status: "HALF_DAY", worked: 2 * 60 });
  });

  it("handles overnight shifts", () => {
    const night = { startMinute: 23 * 60, endMinute: 7 * 60, breakMinutes: 30 };
    expect(computeAttendance(night, 23 * 60 + 15, 7 * 60 + 30)).toMatchObject({ status: "LATE", late: 15, worked: 8 * 60 - 15, overtime: 15 });
    expect(computeAttendance(night, 5, 7 * 60)).toMatchObject({ late: 65 }); // arrived 00:05 for a 23:00 start
  });

  it("self clock-out closes yesterday's open night shift", async () => {
    const night = await prisma.shift.findFirstOrThrow({ where: { propertyId: ctx.property.id, code: "NGT" } });
    const e = await employee({ defaultShiftId: night.id });
    await tx((t) => selfClock(t, ctx.actor, { employeeId: e.id, today: d("2026-03-10"), nowMinute: 23 * 60, direction: "in" }));
    const row = await tx((t) => selfClock(t, ctx.actor, { employeeId: e.id, today: d("2026-03-11"), nowMinute: 7 * 60, direction: "out" }));
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(row.workedMinutes).toBe(8 * 60 - 30);
  });
});

describe("leave", () => {
  it("enforces yearly entitlement and blocks overlapping requests", async () => {
    const e = await employee();
    const cl = await leaveType("CL"); // 6 days
    await tx((t) => requestLeave(t, ctx.actor, { employeeId: e.id, leaveTypeId: cl.id, startDate: d("2026-04-01"), endDate: d("2026-04-04") }));
    await expect(tx((t) => requestLeave(t, ctx.actor, { employeeId: e.id, leaveTypeId: cl.id, startDate: d("2026-05-01"), endDate: d("2026-05-03") }))).rejects.toThrow(/Not enough casual leave/);
    const al = await leaveType("AL");
    await expect(tx((t) => requestLeave(t, ctx.actor, { employeeId: e.id, leaveTypeId: al.id, startDate: d("2026-04-03"), endDate: d("2026-04-08") }))).rejects.toThrow(/overlaps/);
  });

  it("the database rejects overlapping active leave even if code is bypassed", async () => {
    const e = await employee();
    const al = await leaveType("AL");
    await prisma.leaveRequest.create({ data: { employeeId: e.id, leaveTypeId: al.id, startDate: d("2026-06-01"), endDate: d("2026-06-05"), days: 5 } });
    await expect(prisma.leaveRequest.create({ data: { employeeId: e.id, leaveTypeId: al.id, startDate: d("2026-06-05"), endDate: d("2026-06-06"), days: 2 } })).rejects.toThrow(/leave_requests_no_overlap/);
  });

  it("approving leave converts recorded absences to leave", async () => {
    const e = await employee();
    await tx((t) => recordAttendance(t, ctx.actor, { employeeId: e.id, date: d("2026-02-10"), status: "ABSENT", clockIn: null, clockOut: null }));
    const sl = await leaveType("SL");
    const r = await tx((t) => requestLeave(t, ctx.actor, { employeeId: e.id, leaveTypeId: sl.id, startDate: d("2026-02-10"), endDate: d("2026-02-10") }));
    await tx((t) => decideLeave(t, ctx.actor, { requestId: r.id, approve: true }));
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: e.id } })).status).toBe("ON_LEAVE");
  });
});

describe("payroll", () => {
  it("prorates joiners, deducts unpaid leave and absences, pays overtime, and posts balanced ledger entries", async () => {
    const full = await employee({ baseSalary: 3000 });
    const joiner = await employee({ firstName: "New", hireDate: d("2026-03-16"), baseSalary: 3100 });
    await employee({ firstName: "Later", hireDate: d("2026-04-01") }); // not employed in March
    const ul = await leaveType("UL");
    const r = await tx((t) => requestLeave(t, ctx.actor, { employeeId: full.id, leaveTypeId: ul.id, startDate: d("2026-03-02"), endDate: d("2026-03-03") }));
    await tx((t) => decideLeave(t, ctx.actor, { requestId: r.id, approve: true }));
    await tx((t) => recordAttendance(t, ctx.actor, { employeeId: full.id, date: d("2026-03-05"), status: "ABSENT", clockIn: null, clockOut: null }));
    await tx((t) => recordAttendance(t, ctx.actor, { employeeId: full.id, date: d("2026-03-06"), clockIn: 9 * 60, clockOut: 19 * 60 })); // no shift: 8h scheduled → 2h OT

    const run = await tx((t) => createPayrollRun(t, ctx.actor, { period: monthPeriod("2026-03") }));
    const items = await prisma.payrollItem.findMany({ where: { runId: run.id } });
    expect(items).toHaveLength(2);
    const a = items.find((i) => i.employeeId === full.id)!;
    expect(a.basePay.toNumber()).toBe(3000);
    expect(a.unpaidLeaveDays).toBe(2);
    expect(a.absentDays).toBe(1);
    expect(a.deductionForDays.toNumber()).toBe(290.32); // 3000 / 31 × 3
    expect(a.overtimePay.toNumber()).toBe(43.27); // 3000 / 208 × 1.5 × 2
    const b = items.find((i) => i.employeeId === joiner.id)!;
    expect(b.employedDays).toBe(16);
    expect(b.basePay.toNumber()).toBe(1600); // 3100 / 31 × 16

    await tx((t) => updatePayrollItem(t, ctx.actor, { itemId: a.id, allowances: 100, withholding: 250 }));
    await expect(tx((t) => updatePayrollItem(t, ctx.actor, { itemId: b.id, allowances: 0, withholding: 5000 }))).rejects.toThrow(/cannot exceed gross/);
    await expect(tx((t) => createPayrollRun(t, ctx.actor, { period: monthPeriod("2026-03") }))).rejects.toThrow(/already exists/);

    const approved = await tx((t) => approvePayrollRun(t, ctx.actor, run.id, d("2026-04-02")));
    const fresh = await prisma.payrollRun.findUniqueOrThrow({ where: { id: approved.id } });
    const gross = 3000 - 290.32 + 43.27 + 100 + 1600;
    expect(fresh.totalGross.toNumber()).toBeCloseTo(gross, 2);
    expect(fresh.totalWithholding.toNumber()).toBe(250);
    let bal = await balances(ctx.property.id);
    expect(bal["5000"]).toBeCloseTo(gross, 2);
    expect(bal["2300"]).toBeCloseTo(-(gross - 250), 2);
    expect(bal["2200"]).toBe(-250);
    const accrual = await prisma.journalEntry.findFirstOrThrow({ where: { id: fresh.accrualEntryId! } });
    expect(accrual.date.toISOString().slice(0, 10)).toBe("2026-03-31");

    // Approved payroll locks the period's attendance.
    await expect(tx((t) => recordAttendance(t, ctx.actor, { employeeId: full.id, date: d("2026-03-20"), status: "ABSENT", clockIn: null, clockOut: null }))).rejects.toThrow(/already approved/);
    await expect(tx((t) => updatePayrollItem(t, ctx.actor, { itemId: a.id, allowances: 0, withholding: 0 }))).rejects.toThrow(/Only draft/);

    await tx((t) => payPayrollRun(t, ctx.actor, { runId: run.id, method: "BANK_TRANSFER", today: d("2026-04-02") }));
    bal = await balances(ctx.property.id);
    expect(bal["2300"]).toBeCloseTo(0, 2);
    expect(bal["1010"]).toBeCloseTo(-(gross - 250), 2);
    await expect(tx((t) => payPayrollRun(t, ctx.actor, { runId: run.id, method: "CASH", today: d("2026-04-02") }))).rejects.toThrow(/already been paid/);
  });

  it("approved leave in an approved payroll period cannot be cancelled", async () => {
    const e = await employee();
    const al = await leaveType("AL");
    const r = await tx((t) => requestLeave(t, ctx.actor, { employeeId: e.id, leaveTypeId: al.id, startDate: d("2026-03-10"), endDate: d("2026-03-11"), autoApprove: true }));
    const run = await tx((t) => createPayrollRun(t, ctx.actor, { period: monthPeriod("2026-03") }));
    await tx((t) => approvePayrollRun(t, ctx.actor, run.id, d("2026-04-01")));
    await expect(tx((t) => cancelLeave(t, ctx.actor, r.id, { allowApproved: true }))).rejects.toThrow(/already approved/);
  });
});
