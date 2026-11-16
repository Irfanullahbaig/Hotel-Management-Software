"use client";

import { useState } from "react";
import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { ActionState } from "@/server/actions/types";
import {
  cancelLeaveAction, clockAction, decideLeaveAction, hrLeaveAction, markAbsentAction, myLeaveAction, recordAttendanceAction,
  saveDepartmentAction, saveEmployeeAction, saveLeaveTypeAction, saveRosterAction, saveShiftAction, setEmployeeStatusAction,
} from "@/server/actions/hr";

type Opt = { id: string; name: string };
type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

/** A single button that posts hidden fields to an action. */
export function ActionButton({ action, fields, label, variant = "primary", size = "sm", confirm, pendingText }: {
  action: Action; fields: Record<string, string>; label: string; variant?: "primary" | "secondary" | "danger" | "ghost" | "danger-outline"; size?: "sm" | "md"; confirm?: string; pendingText?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-flex flex-col items-end gap-1">
      {(s) => (
        <>
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <SubmitButton size={size} variant={variant} pendingText={pendingText}>{label}</SubmitButton>
          {s && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}

// ─── Employees ───

export type EmployeeValue = {
  id?: string; firstName?: string; lastName?: string; email?: string | null; phone?: string | null; departmentId?: string | null; jobTitle?: string;
  employmentType?: string; hireDate?: string; dateOfBirth?: string | null; gender?: string | null; address?: string | null; defaultShiftId?: string | null;
  userId?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null; notes?: string | null;
  nationalId?: string | null; bankName?: string | null; bankAccount?: string | null; baseSalary?: string;
};

export function EmployeeForm({ employee, departments, shifts, users, sensitive, currency, today }: {
  employee?: EmployeeValue; departments: Opt[]; shifts: Opt[]; users: (Opt & { email: string })[]; sensitive: boolean; currency: string; today: string;
}) {
  const v = (k: keyof EmployeeValue) => (employee?.[k] as string | null | undefined) ?? "";
  return (
    <ActionForm action={saveEmployeeAction} className="grid gap-3 sm:grid-cols-4">
      {(s) => (
        <>
          {employee?.id && <input type="hidden" name="id" value={employee.id} />}
          <h3 className="text-sm font-semibold sm:col-span-4">Personal</h3>
          <Field label="First name" required className="sm:col-span-2"><Input name="firstName" defaultValue={v("firstName")} required /></Field>
          <Field label="Last name" required className="sm:col-span-2"><Input name="lastName" defaultValue={v("lastName")} required /></Field>
          <Field label="Email" className="sm:col-span-2"><Input name="email" type="email" defaultValue={v("email")} /></Field>
          <Field label="Phone" className="sm:col-span-2"><Input name="phone" defaultValue={v("phone")} /></Field>
          <Field label="Date of birth"><Input name="dateOfBirth" type="date" defaultValue={v("dateOfBirth")} /></Field>
          <Field label="Gender"><Select name="gender" defaultValue={v("gender")}><option value="">—</option><option>Female</option><option>Male</option><option>Other</option></Select></Field>
          <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={v("address")} /></Field>
          <Field label="Emergency contact" className="sm:col-span-2"><Input name="emergencyContactName" defaultValue={v("emergencyContactName")} /></Field>
          <Field label="Emergency phone" className="sm:col-span-2"><Input name="emergencyContactPhone" defaultValue={v("emergencyContactPhone")} /></Field>

          <h3 className="mt-2 text-sm font-semibold sm:col-span-4">Job</h3>
          <Field label="Job title" required className="sm:col-span-2"><Input name="jobTitle" defaultValue={v("jobTitle")} required placeholder="Receptionist, Room Attendant…" /></Field>
          <Field label="Department" className="sm:col-span-2">
            <Select name="departmentId" defaultValue={v("departmentId")}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
          <Field label="Employment type">
            <Select name="employmentType" defaultValue={v("employmentType") || "FULL_TIME"}>
              <option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="CONTRACT">Contract</option><option value="INTERN">Intern</option>
            </Select>
          </Field>
          <Field label="Start date" required><Input name="hireDate" type="date" defaultValue={v("hireDate") || today} required /></Field>
          <Field label="Usual shift" hint="Used when the roster has no entry">
            <Select name="defaultShiftId" defaultValue={v("defaultShiftId")}><option value="">None</option>{shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          </Field>
          <Field label="System login" hint="Lets them clock in and request leave">
            <Select name="userId" defaultValue={v("userId")}><option value="">Not linked</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</Select>
          </Field>

          {sensitive && (
            <>
              <h3 className="mt-2 text-sm font-semibold sm:col-span-4">Pay & identification <span className="font-normal text-ink-3">(visible to HR and payroll approvers only)</span></h3>
              <Field label={`Monthly salary (${currency})`}><Input name="baseSalary" type="number" min="0" step="0.01" defaultValue={v("baseSalary") || "0"} /></Field>
              <Field label="National ID"><Input name="nationalId" defaultValue={v("nationalId")} /></Field>
              <Field label="Bank"><Input name="bankName" defaultValue={v("bankName")} /></Field>
              <Field label="Bank account / IBAN"><Input name="bankAccount" defaultValue={v("bankAccount")} /></Field>
            </>
          )}
          <Field label="Notes" className="sm:col-span-4"><Textarea name="notes" defaultValue={v("notes")} /></Field>
          <div className="sm:col-span-4"><FormMessage state={s} /></div>
          <div className="sm:col-span-4"><SubmitButton>{employee?.id ? "Save employee" : "Add employee"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function EmployeeStatusDialog({ id, status, today }: { id: string; status: string; today: string }) {
  const [next, setNext] = useState(status);
  return (
    <Dialog title="Change employment status" trigger={(open) => <Button variant="secondary" onClick={open}>Change status</Button>}>
      {(close) => (
        <ActionForm action={setEmployeeStatusAction} onSuccess={close} className="grid gap-3">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field label="Status">
                <Select name="status" value={next} onChange={(e) => setNext(e.target.value)}>
                  <option value="ACTIVE">Active</option><option value="ON_LEAVE">On extended leave</option><option value="SUSPENDED">Suspended (excluded from payroll)</option><option value="TERMINATED">Left the hotel</option>
                </Select>
              </Field>
              {next === "TERMINATED" && (
                <>
                  <Field label="Last working day" required><Input type="date" name="terminationDate" defaultValue={today} required /></Field>
                  <Field label="Reason"><Input name="terminationReason" placeholder="Resignation, end of contract…" /></Field>
                </>
              )}
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

// ─── Setup ───

export function DepartmentDialog({ dep }: { dep?: { id: string; code: string; name: string; isActive: boolean } }) {
  return (
    <Dialog title={dep ? "Edit department" : "New department"} trigger={(open) => <Button size="sm" variant={dep ? "ghost" : "secondary"} onClick={open}>{dep ? "Edit" : "+ Department"}</Button>}>
      {(close) => (
        <ActionForm action={saveDepartmentAction} onSuccess={close} className="grid grid-cols-3 gap-3">
          {(s) => (
            <>
              {dep && <input type="hidden" name="id" value={dep.id} />}
              <Field label="Code" required><Input name="code" defaultValue={dep?.code} required maxLength={8} /></Field>
              <Field label="Name" required className="col-span-2"><Input name="name" defaultValue={dep?.name} required /></Field>
              {dep && <Checkbox name="isActive" defaultChecked={dep.isActive} label="Active" className="col-span-3" />}
              <div className="col-span-3"><FormMessage state={s} /></div>
              <div className="col-span-3 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ShiftDialog({ shift }: { shift?: { id: string; code: string; name: string; start: string; end: string; breakMinutes: number; isActive: boolean } }) {
  return (
    <Dialog title={shift ? "Edit shift" : "New shift"} trigger={(open) => <Button size="sm" variant={shift ? "ghost" : "secondary"} onClick={open}>{shift ? "Edit" : "+ Shift"}</Button>}>
      {(close) => (
        <ActionForm action={saveShiftAction} onSuccess={close} className="grid grid-cols-3 gap-3">
          {(s) => (
            <>
              {shift && <input type="hidden" name="id" value={shift.id} />}
              <Field label="Code" required><Input name="code" defaultValue={shift?.code} required maxLength={8} /></Field>
              <Field label="Name" required className="col-span-2"><Input name="name" defaultValue={shift?.name} required /></Field>
              <Field label="Starts" required><Input name="start" type="time" defaultValue={shift?.start ?? "09:00"} required /></Field>
              <Field label="Ends" required hint="Earlier than start = overnight"><Input name="end" type="time" defaultValue={shift?.end ?? "17:00"} required /></Field>
              <Field label="Break (min)"><Input name="breakMinutes" type="number" min="0" max="240" defaultValue={shift?.breakMinutes ?? 30} /></Field>
              {shift && <Checkbox name="isActive" defaultChecked={shift.isActive} label="Active" className="col-span-3" />}
              <div className="col-span-3"><FormMessage state={s} /></div>
              <div className="col-span-3 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function LeaveTypeDialog({ type }: { type?: { id: string; code: string; name: string; annualDays: number; isPaid: boolean; isActive: boolean } }) {
  return (
    <Dialog title={type ? "Edit leave type" : "New leave type"} trigger={(open) => <Button size="sm" variant={type ? "ghost" : "secondary"} onClick={open}>{type ? "Edit" : "+ Leave type"}</Button>}>
      {(close) => (
        <ActionForm action={saveLeaveTypeAction} onSuccess={close} className="grid grid-cols-3 gap-3">
          {(s) => (
            <>
              {type && <input type="hidden" name="id" value={type.id} />}
              <Field label="Code" required><Input name="code" defaultValue={type?.code} required maxLength={8} /></Field>
              <Field label="Name" required className="col-span-2"><Input name="name" defaultValue={type?.name} required /></Field>
              <Field label="Days per year" hint="0 = no limit"><Input name="annualDays" type="number" min="0" max="365" defaultValue={type?.annualDays ?? 0} /></Field>
              <div className="col-span-2 flex flex-col justify-center gap-2">
                <Checkbox name="isPaid" defaultChecked={type?.isPaid ?? true} label="Paid (unpaid days are deducted in payroll)" />
                {type && <Checkbox name="isActive" defaultChecked={type.isActive} label="Active" />}
              </div>
              <div className="col-span-3"><FormMessage state={s} /></div>
              <div className="col-span-3 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

// ─── Roster ───

export function RosterForm({ children }: { children: React.ReactNode }) {
  return (
    <ActionForm action={saveRosterAction}>
      {(s) => (
        <>
          {children}
          <div className="flex items-center justify-between gap-3 border-t border-border p-3">
            <div>{s && <FormMessage state={s} />}</div>
            <SubmitButton>Save roster</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

// ─── Attendance ───

export function AttendanceRowForm({ employeeId, date, clockIn, clockOut, status, note }: { employeeId: string; date: string; clockIn: string; clockOut: string; status: string; note: string }) {
  return (
    <ActionForm action={recordAttendanceAction} className="flex flex-wrap items-center justify-end gap-1.5">
      {(s) => (
        <>
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="date" value={date} />
          <Input name="clockIn" type="time" defaultValue={clockIn} className="h-8 w-[6.5rem] text-xs" aria-label="Clock in" />
          <Input name="clockOut" type="time" defaultValue={clockOut} className="h-8 w-[6.5rem] text-xs" aria-label="Clock out" />
          <Select name="status" defaultValue={["ABSENT", "ON_LEAVE", "DAY_OFF", "HALF_DAY"].includes(status) ? status : ""} className="h-8 w-32 text-xs" aria-label="Status">
            <option value="">From times</option><option value="HALF_DAY">Half day</option><option value="ABSENT">Absent</option><option value="ON_LEAVE">On leave</option><option value="DAY_OFF">Day off</option>
          </Select>
          <Input name="note" defaultValue={note} placeholder="Note" className="h-8 w-32 text-xs" aria-label="Note" />
          <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
          {s && !s.ok && <div className="w-full"><FormMessage state={s} /></div>}
        </>
      )}
    </ActionForm>
  );
}

export function CloseDayButton({ date }: { date: string }) {
  return <ActionButton action={markAbsentAction} fields={{ date }} label="Mark unrecorded as absent" variant="secondary" confirm="Everyone without a record for this day will be marked absent (or on leave where approved). Continue?" />;
}

// ─── Leave ───

function LeaveFields({ leaveTypes, today }: { leaveTypes: Opt[]; today: string }) {
  return (
    <>
      <Field label="Leave type" required className="col-span-2">
        <Select name="leaveTypeId" required>{leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </Field>
      <Field label="From" required><Input type="date" name="startDate" defaultValue={today} required /></Field>
      <Field label="To (inclusive)" required><Input type="date" name="endDate" defaultValue={today} required /></Field>
      <Field label="Reason" className="col-span-2"><Textarea name="reason" /></Field>
    </>
  );
}

export function HrLeaveDialog({ employees, leaveTypes, today, canApprove, employeeId }: { employees: Opt[]; leaveTypes: Opt[]; today: string; canApprove: boolean; employeeId?: string }) {
  return (
    <Dialog title="Record leave" description="For an employee who asked in person or by phone." trigger={(open) => <Button onClick={open} variant={employeeId ? "secondary" : "primary"}>+ Record leave</Button>}>
      {(close) => (
        <ActionForm action={hrLeaveAction} onSuccess={close} className="grid grid-cols-2 gap-3">
          {(s) => (
            <>
              {employeeId ? <input type="hidden" name="employeeId" value={employeeId} /> : (
                <Field label="Employee" required className="col-span-2">
                  <Select name="employeeId" required><option value="">Choose…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
                </Field>
              )}
              <LeaveFields leaveTypes={leaveTypes} today={today} />
              {canApprove && <Checkbox name="approveNow" defaultChecked label="Approve now" className="col-span-2" />}
              <div className="col-span-2"><FormMessage state={s} /></div>
              <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function MyLeaveForm({ leaveTypes, today }: { leaveTypes: Opt[]; today: string }) {
  return (
    <ActionForm action={myLeaveAction} resetOnSuccess className="grid grid-cols-2 gap-3">
      {(s) => (
        <>
          <LeaveFields leaveTypes={leaveTypes} today={today} />
          <div className="col-span-2"><FormMessage state={s} /></div>
          <div className="col-span-2"><SubmitButton>Request leave</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function DecisionButtons({ requestId }: { requestId: string }) {
  return (
    <div className="flex justify-end gap-1.5">
      <ActionButton action={decideLeaveAction} fields={{ requestId, decision: "reject" }} label="Reject" variant="secondary" confirm="Reject this leave request?" />
      <ActionButton action={decideLeaveAction} fields={{ requestId, decision: "approve" }} label="Approve" />
    </div>
  );
}

export function CancelLeaveButton({ requestId }: { requestId: string }) {
  return <ActionButton action={cancelLeaveAction} fields={{ requestId }} label="Cancel" variant="ghost" confirm="Cancel this leave?" />;
}

// ─── Self-service clock ───

export function ClockButton({ direction }: { direction: "in" | "out" }) {
  return <ActionButton action={clockAction} fields={{ direction }} label={direction === "in" ? "Clock in" : "Clock out"} size="md" variant={direction === "in" ? "primary" : "secondary"} pendingText="Saving…" />;
}
