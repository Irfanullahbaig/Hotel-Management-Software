import type { AttendanceStatus, Shift } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { addDays, diffNights, parseDateOnly } from "@/lib/dates";
import { DAY_MINUTES, shiftSpan } from "@/lib/time";
import { BusinessError, assert, audit, nextNumber, notify, pad, type Actor } from "./common";

/** Minutes after the shift start that still count as on time. */
export const LATE_GRACE_MINUTES = 10;
/** Scheduled work when no shift is assigned. */
export const DEFAULT_WORK_MINUTES = 8 * 60;

// ─── Defaults every property gets (operational setup, not demo data) ───

export const DEFAULT_DEPARTMENTS = [
  ["FO", "Front Office"], ["HK", "Housekeeping"], ["FB", "Food & Beverage"], ["MNT", "Maintenance & Engineering"],
  ["FIN", "Finance & Accounts"], ["HR", "Human Resources"], ["SEC", "Security"], ["SM", "Sales & Marketing"], ["ADM", "Administration"],
] as const;

export const DEFAULT_SHIFTS = [
  { code: "MOR", name: "Morning", start: 7 * 60, end: 15 * 60, break: 30 },
  { code: "EVE", name: "Evening", start: 15 * 60, end: 23 * 60, break: 30 },
  { code: "NGT", name: "Night", start: 23 * 60, end: 7 * 60, break: 30 },
  { code: "OFF", name: "Office", start: 9 * 60, end: 17 * 60, break: 60 },
] as const;

export const DEFAULT_LEAVE_TYPES = [
  { code: "AL", name: "Annual leave", annualDays: 14, isPaid: true },
  { code: "SL", name: "Sick leave", annualDays: 10, isPaid: true },
  { code: "CL", name: "Casual leave", annualDays: 6, isPaid: true },
  { code: "UL", name: "Unpaid leave", annualDays: 0, isPaid: false },
] as const;

export async function ensureHrDefaults(tx: Tx, propertyId: string) {
  for (const [code, name] of DEFAULT_DEPARTMENTS) {
    await tx.department.upsert({ where: { propertyId_code: { propertyId, code } }, update: {}, create: { propertyId, code, name } });
  }
  for (const s of DEFAULT_SHIFTS) {
    await tx.shift.upsert({ where: { propertyId_code: { propertyId, code: s.code } }, update: {}, create: { propertyId, code: s.code, name: s.name, startMinute: s.start, endMinute: s.end, breakMinutes: s.break } });
  }
  for (const l of DEFAULT_LEAVE_TYPES) {
    await tx.leaveType.upsert({ where: { propertyId_code: { propertyId, code: l.code } }, update: {}, create: { propertyId, ...l } });
  }
}

// ─── Employees ───

export async function nextEmployeeNo(tx: Tx, propertyId: string) {
  return `EMP-${pad(await nextNumber(tx, propertyId, "EMP"), 4)}`;
}

export const employeeName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();

// ─── Dates ───

/** Inclusive number of calendar days between two dates. */
export const inclusiveDays = (start: Date, end: Date) => diffNights(start, end) + 1;

/** Days of [aStart, aEnd] (inclusive) that fall inside [bStart, bEnd] (inclusive). */
export function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return e < s ? 0 : inclusiveDays(s, e);
}

const yearBounds = (year: number) => [parseDateOnly(`${year}-01-01`), parseDateOnly(`${year}-12-31`)] as const;

// ─── Leave ───

/** Approved and pending days of one leave type that fall in a calendar year. */
export async function leaveUsage(tx: Tx, employeeId: string, leaveTypeId: string, year: number, excludeRequestId?: string) {
  const [ys, ye] = yearBounds(year);
  const reqs = await tx.leaveRequest.findMany({
    where: { employeeId, leaveTypeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: ye }, endDate: { gte: ys }, id: excludeRequestId ? { not: excludeRequestId } : undefined },
  });
  let approved = 0;
  let pending = 0;
  for (const r of reqs) {
    const d = overlapDays(r.startDate, r.endDate, ys, ye);
    if (r.status === "APPROVED") approved += d;
    else pending += d;
  }
  return { approved, pending };
}

/** Entitlement, used and remaining days for every active leave type in a year. */
export async function leaveBalances(tx: Tx, propertyId: string, employeeId: string, year: number) {
  const types = await tx.leaveType.findMany({ where: { propertyId, isActive: true }, orderBy: { name: "asc" } });
  return Promise.all(
    types.map(async (t) => {
      const u = await leaveUsage(tx, employeeId, t.id, year);
      const capped = t.annualDays > 0;
      return { type: t, entitlement: capped ? t.annualDays : null, used: u.approved, pending: u.pending, remaining: capped ? t.annualDays - u.approved - u.pending : null };
    }),
  );
}

async function checkEntitlement(tx: Tx, req: { employeeId: string; leaveTypeId: string; startDate: Date; endDate: Date }, excludeRequestId?: string) {
  const type = await tx.leaveType.findUniqueOrThrow({ where: { id: req.leaveTypeId } });
  if (type.annualDays <= 0) return type; // uncapped (e.g. unpaid leave)
  for (let y = req.startDate.getUTCFullYear(); y <= req.endDate.getUTCFullYear(); y++) {
    const [ys, ye] = yearBounds(y);
    const asking = overlapDays(req.startDate, req.endDate, ys, ye);
    const u = await leaveUsage(tx, req.employeeId, req.leaveTypeId, y, excludeRequestId);
    const left = type.annualDays - u.approved - u.pending;
    if (asking > left) throw new BusinessError(`Not enough ${type.name.toLowerCase()} for ${y}: ${asking} day(s) requested, ${Math.max(0, left)} remaining.`);
  }
  return type;
}

export async function requestLeave(
  tx: Tx,
  actor: Actor,
  input: { employeeId: string; leaveTypeId: string; startDate: Date; endDate: Date; reason?: string | null; autoApprove?: boolean },
) {
  assert(input.endDate >= input.startDate, "The leave must end on or after its start date.");
  const emp = await tx.employee.findFirst({ where: { id: input.employeeId, propertyId: actor.propertyId } });
  assert(emp, "Employee not found.");
  assert(emp.status !== "TERMINATED", "This employee has left the hotel.");
  const type = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId, propertyId: actor.propertyId, isActive: true } });
  assert(type, "Choose a valid leave type.");
  const clash = await tx.leaveRequest.findFirst({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } } });
  if (clash) throw new BusinessError("This overlaps another pending or approved leave request.");
  await checkEntitlement(tx, input);
  const days = inclusiveDays(input.startDate, input.endDate);
  const req = await tx.leaveRequest.create({
    data: { employeeId: emp.id, leaveTypeId: type.id, startDate: input.startDate, endDate: input.endDate, days, reason: input.reason ?? null, requestedById: actor.userId },
  });
  await audit(tx, actor, "leave.request", "LeaveRequest", req.id, `${employeeName(emp)} requested ${days} day(s) of ${type.name.toLowerCase()}`);
  if (input.autoApprove) return decideLeave(tx, actor, { requestId: req.id, approve: true, note: "Recorded by HR" });
  await notify(tx, actor.propertyId, { type: "LEAVE_REQUEST", title: `Leave request: ${employeeName(emp)}`, body: `${type.name}, ${days} day(s)`, link: "/hr/leave" });
  return req;
}

export async function decideLeave(tx: Tx, actor: Actor, input: { requestId: string; approve: boolean; note?: string | null }) {
  const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id: input.requestId }, include: { employee: true, leaveType: true } });
  assert(req.employee.propertyId === actor.propertyId, "Leave request belongs to another property.");
  assert(req.status === "PENDING", "This request has already been decided.");
  if (input.approve) await checkEntitlement(tx, req, req.id);
  const updated = await tx.leaveRequest.update({
    where: { id: req.id },
    data: { status: input.approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null },
  });
  if (input.approve) {
    // Days already marked absent become leave, so payroll does not deduct them twice.
    await tx.attendance.updateMany({ where: { employeeId: req.employeeId, date: { gte: req.startDate, lte: req.endDate }, status: "ABSENT" }, data: { status: "ON_LEAVE" } });
  }
  await audit(tx, actor, input.approve ? "leave.approve" : "leave.reject", "LeaveRequest", req.id, `${input.approve ? "Approved" : "Rejected"} ${req.days} day(s) of ${req.leaveType.name.toLowerCase()} for ${employeeName(req.employee)}`);
  if (req.employee.userId) {
    await notify(tx, actor.propertyId, { userId: req.employee.userId, type: "LEAVE_DECISION", title: `Leave ${input.approve ? "approved" : "rejected"}`, body: `${req.leaveType.name}, ${req.days} day(s)${input.note ? ` · ${input.note}` : ""}`, link: "/my-time" });
  }
  return updated;
}

export async function cancelLeave(tx: Tx, actor: Actor, requestId: string, opts: { allowApproved: boolean }) {
  const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId }, include: { employee: true } });
  assert(req.employee.propertyId === actor.propertyId, "Leave request belongs to another property.");
  if (req.status === "APPROVED") {
    assert(opts.allowApproved, "Only HR can cancel approved leave.");
    const locked = await tx.payrollItem.findFirst({ where: { employeeId: req.employeeId, run: { status: { in: ["APPROVED", "PAID"] }, periodStart: { lte: req.endDate }, periodEnd: { gte: req.startDate } } } });
    assert(!locked, "This leave falls in a payroll period that is already approved. It can no longer be cancelled.");
  } else {
    assert(req.status === "PENDING", "Only pending or approved requests can be cancelled.");
  }
  await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() } });
  await audit(tx, actor, "leave.cancel", "LeaveRequest", req.id, `Cancelled leave for ${employeeName(req.employee)}`);
}

/** The approved leave (if any) covering a date. */
export async function approvedLeaveOn(tx: Tx, employeeId: string, date: Date) {
  return tx.leaveRequest.findFirst({ where: { employeeId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } }, include: { leaveType: true } });
}

// ─── Shifts & attendance ───

/** The shift an employee works on a date: the roster entry, else their default shift. */
export async function shiftFor(tx: Tx, employeeId: string, date: Date) {
  const a = await tx.shiftAssignment.findUnique({ where: { employeeId_date: { employeeId, date } }, include: { shift: true } });
  if (a) return a.shift;
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { defaultShift: true } });
  return e.defaultShift;
}

/**
 * Derive worked, late and overtime minutes from clock times.
 * Clock-out earlier than clock-in is treated as the next day (overnight).
 */
export function computeAttendance(shift: Pick<Shift, "startMinute" | "endMinute" | "breakMinutes"> | null, clockIn: number | null, clockOut: number | null) {
  const scheduled = shift ? shiftSpan(shift.startMinute, shift.endMinute) - shift.breakMinutes : DEFAULT_WORK_MINUTES;
  let late = 0;
  if (shift && clockIn != null) {
    // Distance from shift start, allowing for overnight shifts (start 23:00, arrival 23:20 or 00:05).
    let d = clockIn - shift.startMinute;
    if (d < -DAY_MINUTES / 2) d += DAY_MINUTES;
    if (d > DAY_MINUTES / 2) d -= DAY_MINUTES;
    late = Math.max(0, d);
  }
  let out = clockOut;
  if (clockIn != null && out != null && out <= clockIn) out += DAY_MINUTES;
  const breakMin = shift?.breakMinutes ?? 0;
  const worked = clockIn != null && out != null ? Math.max(0, out - clockIn - breakMin) : 0;
  const overtime = clockIn != null && out != null ? Math.max(0, worked - scheduled) : 0;
  let status: AttendanceStatus = late > LATE_GRACE_MINUTES ? "LATE" : "PRESENT";
  if (clockIn != null && out != null && worked < scheduled / 2) status = "HALF_DAY";
  return { clockOut: out, worked, late, overtime, scheduled, status };
}

export async function recordAttendance(
  tx: Tx,
  actor: Actor,
  input: { employeeId: string; date: Date; status?: AttendanceStatus | null; clockIn: number | null; clockOut: number | null; note?: string | null; source?: "MANUAL" | "SELF" },
) {
  const emp = await tx.employee.findFirst({ where: { id: input.employeeId, propertyId: actor.propertyId } });
  assert(emp, "Employee not found.");
  assert(input.date >= emp.hireDate, "This date is before the employee's start date.");
  assert(!emp.terminationDate || input.date <= emp.terminationDate, "This date is after the employee left.");
  const locked = await tx.payrollItem.findFirst({ where: { employeeId: emp.id, run: { status: { in: ["APPROVED", "PAID"] }, periodStart: { lte: input.date }, periodEnd: { gte: input.date } } } });
  assert(!locked, "Payroll for this date is already approved, so attendance can no longer change.");
  const shift = await shiftFor(tx, emp.id, input.date);
  const noClock = input.clockIn == null && input.clockOut == null;
  assert(input.clockOut == null || input.clockIn != null, "Enter a clock-in time before the clock-out time.");
  let status: AttendanceStatus;
  let c = { clockOut: input.clockOut, worked: 0, late: 0, overtime: 0 };
  if (input.status && ["ABSENT", "ON_LEAVE", "DAY_OFF"].includes(input.status)) {
    status = input.status;
    assert(noClock, "Remove the clock times for an absence, leave or day off.");
  } else {
    assert(!noClock, "Enter a clock-in time, or choose Absent, On leave or Day off.");
    const r = computeAttendance(shift, input.clockIn, input.clockOut);
    c = r;
    status = input.status && input.status !== "PRESENT" ? input.status : r.status;
  }
  if (status === "ABSENT" && (await approvedLeaveOn(tx, emp.id, input.date))) status = "ON_LEAVE";
  const data = {
    propertyId: actor.propertyId, shiftId: shift?.id ?? null, clockInMinute: input.clockIn, clockOutMinute: c.clockOut, status,
    workedMinutes: c.worked, lateMinutes: c.late, overtimeMinutes: c.overtime, note: input.note ?? null, source: input.source ?? "MANUAL", recordedById: actor.userId,
  };
  const row = await tx.attendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date: input.date } }, update: data, create: { ...data, employeeId: emp.id, date: input.date } });
  await audit(tx, actor, "attendance.record", "Attendance", row.id, `${employeeName(emp)} ${status.toLowerCase().replace("_", " ")} on ${input.date.toISOString().slice(0, 10)}`, { after: row });
  return row;
}

/** Self-service clock in / out for the signed-in user's linked employee record. */
export async function selfClock(tx: Tx, actor: Actor, input: { employeeId: string; today: Date; nowMinute: number; direction: "in" | "out" }) {
  const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: input.employeeId, date: input.today } } });
  if (input.direction === "in") {
    assert(!existing || existing.clockInMinute == null, "You have already clocked in today.");
    return recordAttendance(tx, actor, { employeeId: input.employeeId, date: input.today, clockIn: input.nowMinute, clockOut: null, note: existing?.note, source: "SELF" });
  }
  // Clock-out may be the next calendar day for night shifts: close yesterday's open record first.
  const yesterday = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: input.employeeId, date: addDays(input.today, -1) } } });
  const open = existing?.clockInMinute != null && existing.clockOutMinute == null ? existing : yesterday?.clockInMinute != null && yesterday.clockOutMinute == null ? yesterday : null;
  assert(open, "You have not clocked in yet.");
  const out = open.date.getTime() === input.today.getTime() ? input.nowMinute : input.nowMinute + DAY_MINUTES;
  return recordAttendance(tx, actor, { employeeId: input.employeeId, date: open.date, clockIn: open.clockInMinute, clockOut: out, note: open.note, source: "SELF" });
}
