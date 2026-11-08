"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { addGuestDocumentAction, saveGuestAction } from "@/server/actions/guests";

export type GuestFormValue = Partial<Record<"id" | "firstName" | "lastName" | "email" | "phone" | "nationality" | "country" | "address" | "city" | "company" | "preferences" | "notes" | "emergencyContactName" | "emergencyContactPhone" | "dateOfBirth" | "category", string | null>> & { isVip?: boolean; marketingConsent?: boolean };

export function GuestForm({ guest }: { guest?: GuestFormValue }) {
  const v = (k: keyof GuestFormValue) => (guest?.[k] as string | null | undefined) ?? "";
  return (
    <ActionForm action={saveGuestAction} className="grid gap-3 sm:grid-cols-4">
      {(s) => (
        <>
          {guest?.id && <input type="hidden" name="id" value={guest.id} />}
          <Field label="First name" required className="sm:col-span-2"><Input name="firstName" defaultValue={v("firstName")} required /></Field>
          <Field label="Last name" required className="sm:col-span-2"><Input name="lastName" defaultValue={v("lastName")} required /></Field>
          <Field label="Email" className="sm:col-span-2"><Input name="email" type="email" defaultValue={v("email")} /></Field>
          <Field label="Phone" className="sm:col-span-2"><Input name="phone" defaultValue={v("phone")} /></Field>
          <Field label="Nationality"><Input name="nationality" defaultValue={v("nationality")} /></Field>
          <Field label="Country"><Input name="country" defaultValue={v("country")} /></Field>
          <Field label="City"><Input name="city" defaultValue={v("city")} /></Field>
          <Field label="Date of birth"><Input name="dateOfBirth" type="date" defaultValue={v("dateOfBirth")} /></Field>
          <Field label="Address" className="sm:col-span-4"><Input name="address" defaultValue={v("address")} /></Field>
          <Field label="Company" className="sm:col-span-2"><Input name="company" defaultValue={v("company")} /></Field>
          <Field label="Category" className="sm:col-span-2">
            <Select name="category" defaultValue={v("category") || "REGULAR"}>
              <option value="REGULAR">Regular</option><option value="CORPORATE">Corporate</option><option value="GROUP">Group</option><option value="GOVERNMENT">Government</option><option value="TRAVEL_AGENT">Travel agent</option>
            </Select>
          </Field>
          <Field label="Emergency contact" className="sm:col-span-2"><Input name="emergencyContactName" defaultValue={v("emergencyContactName")} /></Field>
          <Field label="Emergency phone" className="sm:col-span-2"><Input name="emergencyContactPhone" defaultValue={v("emergencyContactPhone")} /></Field>
          <Field label="Preferences" className="sm:col-span-2"><Textarea name="preferences" defaultValue={v("preferences")} placeholder="Pillow type, high floor, dietary…" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={v("notes")} /></Field>
          <div className="flex flex-wrap gap-4 sm:col-span-4">
            <Checkbox name="isVip" defaultChecked={guest?.isVip} label="VIP guest" />
            <Checkbox name="marketingConsent" defaultChecked={guest?.marketingConsent} label="Agrees to marketing communication" />
          </div>
          <div className="sm:col-span-4"><FormMessage state={s} /></div>
          <div className="sm:col-span-4"><SubmitButton>{guest?.id ? "Save guest" : "Create guest"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function AddDocumentDialog({ guestId }: { guestId: string }) {
  return (
    <Dialog title="Add identification document" trigger={(open) => <Button size="sm" variant="ghost" onClick={open}>+ Add</Button>}>
      {(close) => (
        <ActionForm action={addGuestDocumentAction} onSuccess={close} className="grid grid-cols-2 gap-3">
          {(s) => (
            <>
              <input type="hidden" name="guestId" value={guestId} />
              <Field label="Type"><Select name="type"><option value="PASSPORT">Passport</option><option value="NATIONAL_ID">National ID</option><option value="DRIVING_LICENSE">Driving licence</option><option value="OTHER">Other</option></Select></Field>
              <Field label="Number" required><Input name="number" required /></Field>
              <Field label="Issuing country"><Input name="issuingCountry" /></Field>
              <Field label="Expiry"><Input name="expiryDate" type="date" /></Field>
              <div className="col-span-2"><FormMessage state={s} /></div>
              <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Add document</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}
