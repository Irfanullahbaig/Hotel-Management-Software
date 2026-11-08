"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { createPropertyAction, deleteRoleAction, markNotificationsReadAction, resetPasswordAction, revokeSessionAction, savePropertyAction, saveRoleAction, saveUserAction } from "@/server/actions/admin";
import { changePasswordAction } from "@/server/actions/auth";

type P = { name: string; address: string | null; phone: string | null; email: string | null; website: string | null; description: string | null; currency: string; timeZone: string; checkInTime: string; checkOutTime: string; taxRate: string; serviceChargeRate: string; depositPercent: string; cancellationPolicy: string | null; requireInspection: boolean; allowCheckoutBalance: boolean };

export function PropertyForm({ p, readOnly }: { p: P; readOnly: boolean }) {
  return (
    <ActionForm action={savePropertyAction} className="grid gap-3 sm:grid-cols-4">
      {(s) => (
        <fieldset disabled={readOnly} className="contents">
          <Field label="Hotel name" required className="sm:col-span-2"><Input name="name" defaultValue={p.name} required /></Field>
          <Field label="Website" className="sm:col-span-2"><Input name="website" defaultValue={p.website ?? ""} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={p.address ?? ""} /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={p.phone ?? ""} /></Field>
          <Field label="Email"><Input name="email" defaultValue={p.email ?? ""} /></Field>
          <Field label="Description" className="sm:col-span-4"><Textarea name="description" defaultValue={p.description ?? ""} /></Field>
          <Field label="Currency" hint="ISO code, e.g. USD, PKR"><Input name="currency" defaultValue={p.currency} maxLength={3} /></Field>
          <Field label="Time zone" hint="Sets the business date"><Input name="timeZone" defaultValue={p.timeZone} placeholder="Asia/Karachi" /></Field>
          <Field label="Check-in time"><Input name="checkInTime" type="time" defaultValue={p.checkInTime} /></Field>
          <Field label="Check-out time"><Input name="checkOutTime" type="time" defaultValue={p.checkOutTime} /></Field>
          <Field label="Tax rate (%)"><Input name="taxRate" type="number" step="0.001" defaultValue={p.taxRate} /></Field>
          <Field label="Service charge (%)"><Input name="serviceChargeRate" type="number" step="0.001" defaultValue={p.serviceChargeRate} /></Field>
          <Field label="Suggested deposit (%)"><Input name="depositPercent" type="number" step="0.001" defaultValue={p.depositPercent} /></Field>
          <div />
          <Field label="Cancellation policy" className="sm:col-span-4"><Textarea name="cancellationPolicy" defaultValue={p.cancellationPolicy ?? ""} /></Field>
          <div className="flex flex-wrap gap-4 sm:col-span-4">
            <Checkbox name="requireInspection" defaultChecked={p.requireInspection} label="Rooms must pass inspection before they can be sold" />
            <Checkbox name="allowCheckoutBalance" defaultChecked={p.allowCheckoutBalance} label="Allow check-out with balance (still needs the permission)" />
          </div>
          <div className="sm:col-span-4"><FormMessage state={s} /></div>
          {!readOnly && <div className="sm:col-span-4"><SubmitButton>Save settings</SubmitButton></div>}
        </fieldset>
      )}
    </ActionForm>
  );
}

export function NewPropertyDialog() {
  return (
    <Dialog title="Add property" description="Each property gets its own rooms, guests, folios and chart of accounts." trigger={(open) => <Button variant="secondary" onClick={open}>Add property</Button>}>
      {(close) => (
        <ActionForm action={createPropertyAction} onSuccess={close} className="grid grid-cols-2 gap-3">
          {(s) => (
            <>
              <Field label="Name" required className="col-span-2"><Input name="name" required /></Field>
              <Field label="Code" required hint="Used in booking references"><Input name="code" required maxLength={6} /></Field>
              <Field label="Currency" required><Input name="currency" defaultValue="USD" maxLength={3} required /></Field>
              <Field label="Time zone" required className="col-span-2"><Input name="timeZone" defaultValue="UTC" required /></Field>
              <div className="col-span-2"><FormMessage state={s} /></div>
              <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Create property</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

type U = { id?: string; name?: string; email?: string; phone?: string | null; department?: string | null; status?: string; roleIds: string[]; propertyIds: string[] };
export function UserForm({ user, roles, properties, canGrantSuper }: { user: U; roles: { id: string; name: string; key: string; description: string | null }[]; properties: { id: string; name: string }[]; canGrantSuper: boolean }) {
  return (
    <ActionForm action={saveUserAction} className="grid gap-4 sm:grid-cols-2">
      {(s) => (
        <>
          {user.id && <input type="hidden" name="id" value={user.id} />}
          <Field label="Full name" required><Input name="name" defaultValue={user.name} required /></Field>
          <Field label="Email (sign-in)" required><Input name="email" type="email" defaultValue={user.email} required /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={user.phone ?? ""} /></Field>
          <Field label="Department"><Select name="department" defaultValue={user.department ?? ""}><option value="">—</option>{["Administration", "Reception", "Housekeeping", "Finance", "HR", "Restaurant", "Kitchen", "Maintenance", "Security", "Sales & Marketing", "Operations"].map((d) => <option key={d}>{d}</option>)}</Select></Field>
          {user.id ? (
            <Field label="Status"><Select name="status" defaultValue={user.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Deactivated</option><option value="LOCKED">Locked</option></Select></Field>
          ) : (
            <Field label="Initial password" required hint="At least 10 characters with letters and numbers. They must change it at first sign-in."><Input name="password" type="password" autoComplete="new-password" required /></Field>
          )}
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-medium text-ink-2">Roles (a user can hold several)</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {roles.filter((r) => canGrantSuper || r.key !== "super_admin").map((r) => (
                <label key={r.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/50">
                  <input type="checkbox" name="roles" value={r.id} defaultChecked={user.roleIds.includes(r.id)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                  <span><span className="font-medium">{r.name}</span>{r.description && <span className="block text-xs text-ink-3">{r.description}</span>}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-medium text-ink-2">Property access</legend>
            <div className="flex flex-wrap gap-4">{properties.map((p) => <Checkbox key={p.id} name="properties" value={p.id} defaultChecked={user.propertyIds.includes(p.id)} label={p.name} />)}</div>
          </fieldset>
          <div className="sm:col-span-2"><FormMessage state={s} /></div>
          <div className="sm:col-span-2"><SubmitButton>{user.id ? "Save user" : "Create user"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function ResetPasswordDialog({ id }: { id: string }) {
  return (
    <Dialog title="Reset password" description="The user will be signed out everywhere and must choose a new password at next sign-in." trigger={(open) => <Button variant="secondary" onClick={open}>Reset password</Button>}>
      {(close) => (
        <ActionForm action={resetPasswordAction} onSuccess={close} className="flex flex-col gap-3">
          {(s) => (<><input type="hidden" name="id" value={id} /><Field label="Temporary password"><Input name="password" type="password" autoComplete="new-password" required /></Field><FormMessage state={s} /><div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Reset</SubmitButton></div></>)}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function RevokeSessionButton({ id }: { id: string }) {
  return (
    <ActionForm action={revokeSessionAction} confirm="Sign out this session?">
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="danger-outline">Sign out</SubmitButton>
    </ActionForm>
  );
}

export function RoleForm({ role, groups, granted, locked }: { role?: { id: string; name: string; description: string | null }; groups: { module: string; label: string; perms: { code: string; action: string; description: string }[] }[]; granted: string[]; locked: boolean }) {
  const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"];
  return (
    <ActionForm action={saveRoleAction} className="space-y-4">
      {(s) => (
        <fieldset disabled={locked} className="space-y-4">
          {role && <input type="hidden" name="id" value={role.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name" required><Input name="name" defaultValue={role?.name} required /></Field>
            <Field label="Description"><Input name="description" defaultValue={role?.description ?? ""} /></Field>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-ink-3"><tr><th className="px-3 py-2 text-left">Module</th>{ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center capitalize">{a}</th>)}<th className="px-3 py-2 text-left">Special</th></tr></thead>
              <tbody className="divide-y divide-border">
                {groups.map((g) => (
                  <tr key={g.module}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{g.label}</td>
                    {ACTIONS.map((a) => {
                      const p = g.perms.find((x) => x.action === a);
                      return <td key={a} className="px-2 py-2 text-center">{p && <input type="checkbox" name="perm" value={p.code} defaultChecked={granted.includes(p.code)} aria-label={p.description} className="size-4 accent-[var(--color-brand)]" />}</td>;
                    })}
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {g.perms.filter((p) => !ACTIONS.includes(p.action)).map((p) => <Checkbox key={p.code} name="perm" value={p.code} defaultChecked={granted.includes(p.code)} label={<span className="text-xs">{p.description}</span>} />)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormMessage state={s} />
          {!locked && <SubmitButton>Save role</SubmitButton>}
        </fieldset>
      )}
    </ActionForm>
  );
}

export function DeleteRoleButton({ id }: { id: string }) {
  return (
    <ActionForm action={deleteRoleAction} confirm="Delete this role?">
      {(s) => (<><input type="hidden" name="id" value={id} /><SubmitButton variant="danger-outline">Delete role</SubmitButton>{s && !s.ok && <FormMessage state={s} />}</>)}
    </ActionForm>
  );
}

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="flex max-w-sm flex-col gap-3">
      {(s) => (
        <>
          <Field label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password" hint="At least 10 characters with letters and numbers"><Input name="next" type="password" autoComplete="new-password" required /></Field>
          <Field label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
          <FormMessage state={s} />
          <SubmitButton>Change password</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function MarkAllRead() {
  return <ActionForm action={markNotificationsReadAction}><SubmitButton variant="secondary">Mark all read</SubmitButton></ActionForm>;
}
