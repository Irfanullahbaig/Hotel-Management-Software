"use server";

import { z } from "zod";
import { formObject, mutate, zs } from "./util";
import { audit, BusinessError } from "@/server/services/common";
import { can } from "@/server/auth/context";
import { parseDateOnly } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { minutesNow, parseClock } from "@/lib/time";
import {
  cancelLeave, decideLeave, employeeName, nextEmployeeNo, recordAttendance, requestLeave, selfClock,
} from "@/server/services/hr";
import type { ActionState } from "./types";

const optDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), zs.date.optional());
const clock = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().nullable()).transform((v, c) => {
  try {
    return parseClock(v);
  } catch {
    c.addIssue({ code: "custom", message: "Enter a valid time (HH:MM)" });
    return z.NEVER;
  }
});
const nullify = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v])) as { [K in keyof T]: Exclude<T[K], undefined> | null };

// ─── Employees ───

const employeeSchema = z.object({
  id: zs.str,
  firstName: zs.req("First name"), lastName: zs.req("Last name"), email: zs.email, phone: zs.str,
  departmentId: zs.str, jobTitle: zs.req("Job title"),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]),
  hireDate: zs.date, dateOfBirth: optDate, gender: zs.str, address: zs.str,
  defaultShiftId: zs.str, userId: zs.str,
  emergencyContactName: zs.str, emergencyContactPhone: zs.str, notes: zs.text,
  // sensitive
  nationalId: zs.str, bankName: zs.str, bankAccount: zs.str, baseSalary: zs.money,
});

export async function saveEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const editing = !!fd.get("id");
  return mutate(editing ? "hr.edit" : "hr.create", async (tx, ctx) => {
    const d = employeeSchema.parse(formObject(fd));
    const sensitive = can(ctx, "hr.view_sensitive");
    const pid = ctx.property.id;
    if (d.departmentId) await tx.department.findFirstOrThrow({ where: { id: d.departmentId, propertyId: pid } });
    if (d.defaultShiftId) await tx.shift.findFirstOrThrow({ where: { id: d.defaultShiftId, propertyId: pid } });
    if (d.userId) {
      const u = await tx.userProperty.findFirst({ where: { userId: d.userId, propertyId: pid } });
      if (!u) throw new BusinessError("That login does not have access to this property.");
      const taken = await tx.employee.findFirst({ where: { propertyId: pid, userId: d.userId, id: d.id ? { not: d.id } : undefined } });
      if (taken) throw new BusinessError(`That login is already linked to ${employeeName(taken)}.`);
    }
    const { id, nationalId, bankName, bankAccount, baseSalary, ...rest } = d;
    const base = nullify(rest);
    const secret = sensitive ? nullify({ nationalId, bankName, bankAccount }) : {};
    if (id) {
      const before = await tx.employee.findFirstOrThrow({ where: { id, propertyId: pid } });
      const e = await tx.employee.update({ where: { id }, data: { ...base, ...secret, ...(sensitive ? { baseSalary } : {}), hireDate: d.hireDate } as never });
      await audit(tx, ctx.actor, "employee.update", "Employee", e.id, `Updated employee ${employeeName(e)}`, {
        before: { ...before, nationalId: undefined, bankAccount: undefined }, after: { ...e, nationalId: undefined, bankAccount: undefined },
      });
      return { ok: true, message: "Employee saved.", redirectTo: `/hr/employees/${e.id}` };
    }
    if (!sensitive && baseSalary > 0) throw new BusinessError("You are not allowed to set salaries.");
    const e = await tx.employee.create({
      data: { ...base, ...secret, baseSalary: sensitive ? baseSalary : 0, hireDate: d.hireDate, propertyId: pid, employeeNo: await nextEmployeeNo(tx, pid) } as never,
    });
    await audit(tx, ctx.actor, "employee.create", "Employee", e.id, `Added employee ${employeeName(e)} (${e.employeeNo})`);
    return { ok: true, message: "Employee added.", redirectTo: `/hr/employees/${e.id}` };
  });
}

export async function setEmployeeStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const d = z.object({
      id: zs.req("Employee"), status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]),
      terminationDate: optDate, terminationReason: zs.str,
    }).parse(formObject(fd));
    const e = await tx.employee.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } });
    if (d.status === "TERMINATED") {
      if (!d.terminationDate) throw new BusinessError("Enter the last working day.");
      if (d.terminationDate < e.hireDate) throw new BusinessError("The last working day is before the start date.");
      const later = await tx.payrollItem.findFirst({ where: { employeeId: e.id, run: { status: { in: ["APPROVED", "PAID"] }, periodStart: { gt: d.terminationDate } } } });
      if (later) throw new BusinessError("This employee is in an approved payroll after that date.");
      // Future leave after the last day is no longer valid.
      await tx.leaveRequest.updateMany({ where: { employeeId: e.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { gt: d.terminationDate } }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: ctx.user.id, decisionNote: "Employment ended" } });
    }
    const updated = await tx.employee.update({
      where: { id: e.id },
      data: { status: d.status, terminationDate: d.status === "TERMINATED" ? d.terminationDate : null, terminationReason: d.status === "TERMINATED" ? d.terminationReason ?? null : null },
    });
    await audit(tx, ctx.actor, "employee.status", "Employee", e.id, `${employeeName(e)}: ${e.status} → ${d.status}`, { before: { status: e.status }, after: { status: d.status, terminationDate: updated.terminationDate } });
    return { ok: true, message: d.status === "TERMINATED" ? "Employment ended. Their login (if any) is unchanged; deactivate it in Settings → Users." : "Status updated." };
  });
}

// ─── Departments, shifts, leave types ───

export async function saveDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, code: zs.req("Code").transform((s) => s.toUpperCase()), name: zs.req("Name"), isActive: zs.bool }).parse(formObject(fd));
    const data = { code: d.code, name: d.name, isActive: d.id ? d.isActive : true };
    const dep = d.id
      ? await tx.department.update({ where: { id: (await tx.department.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } })).id }, data })
      : await tx.department.create({ data: { ...data, propertyId: ctx.property.id } });
    await audit(tx, ctx.actor, d.id ? "department.update" : "department.create", "Department", dep.id, `${d.id ? "Updated" : "Added"} department ${dep.name}`);
    return { ok: true, message: "Department saved." };
  });
}

export async function saveShiftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, code: zs.req("Code").transform((s) => s.toUpperCase()), name: zs.req("Name"), start: clock, end: clock, breakMinutes: zs.int(0, 240), isActive: zs.bool }).parse(formObject(fd));
    if (d.start == null || d.end == null) throw new BusinessError("Enter start and end times.");
    if (d.start === d.end) throw new BusinessError("A shift cannot start and end at the same time.");
    const data = { code: d.code, name: d.name, startMinute: d.start, endMinute: d.end, breakMinutes: d.breakMinutes, isActive: d.id ? d.isActive : true };
    const s = d.id
      ? await tx.shift.update({ where: { id: (await tx.shift.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } })).id }, data })
      : await tx.shift.create({ data: { ...data, propertyId: ctx.property.id } });
    await audit(tx, ctx.actor, d.id ? "shift.update" : "shift.create", "Shift", s.id, `${d.id ? "Updated" : "Added"} shift ${s.name}`);
    return { ok: true, message: "Shift saved." };
  });
}

export async function saveLeaveTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, code: zs.req("Code").transform((s) => s.toUpperCase()), name: zs.req("Name"), annualDays: zs.int(0, 365), isPaid: zs.bool, isActive: zs.bool }).parse(formObject(fd));
    const data = { code: d.code, name: d.name, annualDays: d.annualDays, isPaid: d.isPaid, isActive: d.id ? d.isActive : true };
    const t = d.id
      ? await tx.leaveType.update({ where: { id: (await tx.leaveType.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } })).id }, data })
      : await tx.leaveType.create({ data: { ...data, propertyId: ctx.property.id } });
    await audit(tx, ctx.actor, d.id ? "leave_type.update" : "leave_type.create", "LeaveType", t.id, `${d.id ? "Updated" : "Added"} leave type ${t.name}`);
    return { ok: true, message: "Leave type saved." };
  });
}

// ─── Roster ───

/** Saves a week of shift assignments. Fields are named `a:<employeeId>:<YYYY-MM-DD>` with a shift id or "" (none). */
export async function saveRosterAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const shifts = new Set((await tx.shift.findMany({ where: { propertyId: ctx.property.id }, select: { id: true } })).map((s) => s.id));
    const emps = new Set((await tx.employee.findMany({ where: { propertyId: ctx.property.id }, select: { id: true } })).map((e) => e.id));
    let changed = 0;
    for (const [k, raw] of fd.entries()) {
      if (!k.startsWith("a:")) continue;
      const [, employeeId, ds] = k.split(":");
      const value = String(raw);
      if (!emps.has(employeeId)) throw new BusinessError("Unknown employee in roster.");
      const date = parseDateOnly(ds);
      const current = await tx.shiftAssignment.findUnique({ where: { employeeId_date: { employeeId, date } } });
      if (!value) {
        if (current) { await tx.shiftAssignment.delete({ where: { id: current.id } }); changed++; }
        continue;
      }
      if (!shifts.has(value)) throw new BusinessError("Unknown shift in roster.");
      if (current?.shiftId === value) continue;
      await tx.shiftAssignment.upsert({ where: { employeeId_date: { employeeId, date } }, update: { shiftId: value }, create: { employeeId, date, shiftId: value } });
      changed++;
    }
    await audit(tx, ctx.actor, "roster.save", "ShiftAssignment", null, `Roster updated (${changed} change${changed === 1 ? "" : "s"})`);
    return { ok: true, message: changed ? `Roster saved (${changed} change${changed === 1 ? "" : "s"}).` : "No changes." };
  });
}

// ─── Attendance ───

export async function recordAttendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const d = z.object({
      employeeId: zs.req("Employee"), date: zs.date, clockIn: clock, clockOut: clock, note: zs.str,
      status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "DAY_OFF"]).optional()),
    }).parse(formObject(fd));
    if (d.date > ctx.today) throw new BusinessError("Attendance cannot be recorded for a future date.");
    await recordAttendance(tx, ctx.actor, { ...d, status: d.status ?? null });
    return { ok: true, message: "Attendance saved." };
  });
}

export async function markAbsentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.edit", async (tx, ctx) => {
    const { date } = z.object({ date: zs.date }).parse(formObject(fd));
    if (date >= ctx.today) throw new BusinessError("Only past days can be closed. Today is still in progress.");
    const emps = await tx.employee.findMany({
      where: { propertyId: ctx.property.id, status: { in: ["ACTIVE", "ON_LEAVE"] }, hireDate: { lte: date }, OR: [{ terminationDate: null }, { terminationDate: { gte: date } }], attendance: { none: { date } } },
    });
    for (const e of emps) await recordAttendance(tx, ctx.actor, { employeeId: e.id, date, status: "ABSENT", clockIn: null, clockOut: null });
    return { ok: true, message: emps.length ? `${emps.length} unrecorded employee(s) marked absent (or on leave where approved).` : "Everyone already has a record for this day." };
  });
}

// ─── Leave ───

const leaveSchema = z.object({ employeeId: zs.str, leaveTypeId: zs.req("Leave type"), startDate: zs.date, endDate: zs.date, reason: zs.text });

/** HR records leave for any employee (approved immediately if they hold hr.approve). */
export async function hrLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.create", async (tx, ctx) => {
    const d = leaveSchema.parse(formObject(fd));
    if (!d.employeeId) throw new BusinessError("Choose an employee.");
    const approve = can(ctx, "hr.approve") && fd.get("approveNow") === "on";
    await requestLeave(tx, ctx.actor, { ...d, employeeId: d.employeeId, autoApprove: approve });
    return { ok: true, message: approve ? "Leave recorded and approved." : "Leave request submitted for approval." };
  });
}

export async function decideLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("hr.approve", async (tx, ctx) => {
    const d = z.object({ requestId: zs.req("Request"), decision: z.enum(["approve", "reject"]), note: zs.str }).parse(formObject(fd));
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id: d.requestId }, include: { employee: true } });
    if (req.employee.userId === ctx.user.id && !ctx.user.isSuperAdmin) throw new BusinessError("You cannot decide your own leave request.");
    await decideLeave(tx, ctx.actor, { requestId: d.requestId, approve: d.decision === "approve", note: d.note });
    return { ok: true, message: d.decision === "approve" ? "Leave approved." : "Leave rejected." };
  });
}

export async function cancelLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate([], async (tx, ctx) => {
    const { requestId } = z.object({ requestId: zs.req("Request") }).parse(formObject(fd));
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId }, include: { employee: true } });
    const own = req.employee.userId === ctx.user.id;
    const hr = can(ctx, "hr.approve");
    if (!own && !hr) throw new BusinessError("You do not have permission to do that.");
    await cancelLeave(tx, ctx.actor, requestId, { allowApproved: hr });
    return { ok: true, message: "Leave cancelled." };
  });
}

// ─── Self-service (any signed-in user linked to an employee record) ───

async function myEmployee(tx: Tx, ctx: { user: { id: string }; property: { id: string } }) {
  const e = await tx.employee.findFirst({ where: { userId: ctx.user.id, propertyId: ctx.property.id } });
  if (!e) throw new BusinessError("Your login is not linked to an employee record at this property. Ask HR to link it.");
  if (e.status === "TERMINATED" || e.status === "SUSPENDED") throw new BusinessError("Your employee record is not active.");
  return e;
}

export async function myLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate([], async (tx, ctx) => {
    const d = leaveSchema.parse(formObject(fd));
    const e = await myEmployee(tx, ctx);
    if (d.startDate < ctx.today && !can(ctx, "hr.create")) throw new BusinessError("Leave in the past must be recorded by HR.");
    await requestLeave(tx, ctx.actor, { ...d, employeeId: e.id });
    return { ok: true, message: "Leave request sent to HR." };
  });
}

export async function clockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate([], async (tx, ctx) => {
    const { direction } = z.object({ direction: z.enum(["in", "out"]) }).parse(formObject(fd));
    const e = await myEmployee(tx, ctx);
    const now = minutesNow(ctx.property.timeZone);
    const row = await selfClock(tx, ctx.actor, { employeeId: e.id, today: ctx.today, nowMinute: now, direction });
    return { ok: true, message: direction === "in" ? (row.status === "LATE" ? `Clocked in (${row.lateMinutes} min late).` : "Clocked in.") : "Clocked out. Have a good rest!" };
  });
}
