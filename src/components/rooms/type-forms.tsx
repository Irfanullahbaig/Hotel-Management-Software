"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { addAmenityAction, addRateAction, saveRoomTypeAction, toggleRateAction } from "@/server/actions/rooms";

type RT = {
  id: string; code: string; name: string; description: string | null; baseOccupancy: number; maxOccupancy: number; maxAdults: number; maxChildren: number;
  bedConfiguration: string | null; sizeSqm: string | null; basePrice: string; extraAdultCharge: string; extraChildCharge: string; isActive: boolean; amenityIds: string[];
};

export function RoomTypeDialog({ type, amenities }: { type?: RT; amenities: { id: string; name: string }[] }) {
  return (
    <Dialog wide title={type ? `Edit ${type.name}` : "New room type"} trigger={(open) => <Button variant={type ? "secondary" : "primary"} size={type ? "sm" : "md"} onClick={open}>{type ? "Edit" : "New room type"}</Button>}>
      {(close) => (
        <ActionForm action={saveRoomTypeAction} onSuccess={close} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(s) => (
            <>
              {type && <input type="hidden" name="id" value={type.id} />}
              <Field label="Code" required><Input name="code" defaultValue={type?.code} required maxLength={10} /></Field>
              <Field label="Name" required className="col-span-1 sm:col-span-3"><Input name="name" defaultValue={type?.name} required /></Field>
              <Field label="Base price / night" required><Input name="basePrice" type="number" step="0.01" min="0" defaultValue={type?.basePrice} required /></Field>
              <Field label="Extra adult / night"><Input name="extraAdultCharge" type="number" step="0.01" min="0" defaultValue={type?.extraAdultCharge ?? 0} /></Field>
              <Field label="Extra child / night"><Input name="extraChildCharge" type="number" step="0.01" min="0" defaultValue={type?.extraChildCharge ?? 0} /></Field>
              <Field label="Size (m²)"><Input name="sizeSqm" type="number" step="0.1" defaultValue={type?.sizeSqm ?? ""} /></Field>
              <Field label="Included guests" hint="in base price"><Input name="baseOccupancy" type="number" min="1" defaultValue={type?.baseOccupancy ?? 2} /></Field>
              <Field label="Max guests"><Input name="maxOccupancy" type="number" min="1" defaultValue={type?.maxOccupancy ?? 2} /></Field>
              <Field label="Max adults"><Input name="maxAdults" type="number" min="1" defaultValue={type?.maxAdults ?? 2} /></Field>
              <Field label="Max children"><Input name="maxChildren" type="number" min="0" defaultValue={type?.maxChildren ?? 0} /></Field>
              <Field label="Beds" className="col-span-2"><Input name="bedConfiguration" defaultValue={type?.bedConfiguration ?? ""} placeholder="1 King" /></Field>
              <div className="col-span-2 flex items-end"><Checkbox name="isActive" defaultChecked={type?.isActive ?? true} label="Active" /></div>
              <Field label="Description" className="col-span-2 sm:col-span-4"><Textarea name="description" defaultValue={type?.description ?? ""} /></Field>
              <fieldset className="col-span-2 sm:col-span-4">
                <legend className="mb-1.5 text-xs font-medium text-ink-2">Amenities</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {amenities.map((a) => <Checkbox key={a.id} name="amenities" value={a.id} defaultChecked={type?.amenityIds.includes(a.id)} label={a.name} />)}
                </div>
              </fieldset>
              <div className="col-span-2 sm:col-span-4"><FormMessage state={s} /></div>
              <div className="col-span-2 flex justify-end gap-2 sm:col-span-4"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AddRateDialog({ roomTypeId, name }: { roomTypeId: string; name: string }) {
  return (
    <Dialog title={`Add rate for ${name}`} description="The highest-priority rate that matches a night wins; otherwise the base price applies." trigger={(open) => <Button variant="ghost" size="sm" onClick={open}>+ Rate</Button>}>
      {(close) => (
        <ActionForm action={addRateAction} onSuccess={close} className="flex flex-col gap-3">
          {(s) => (
            <>
              <input type="hidden" name="roomTypeId" value={roomTypeId} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" required><Input name="name" required placeholder="Summer season" /></Field>
                <Field label="Kind"><Select name="kind"><option value="SEASONAL">Seasonal</option><option value="WEEKEND">Weekend</option><option value="HOLIDAY">Holiday</option><option value="PROMOTIONAL">Promotional</option></Select></Field>
                <Field label="From"><Input type="date" name="startDate" /></Field>
                <Field label="To (inclusive)"><Input type="date" name="endDate" /></Field>
                <Field label="Price / night" required><Input name="price" type="number" step="0.01" min="0" required /></Field>
                <Field label="Priority" hint="higher wins"><Input name="priority" type="number" defaultValue={10} /></Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-ink-2">Days of week (leave empty for every day)</legend>
                <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} name="daysOfWeek" value={i} label={d} />)}</div>
              </fieldset>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Add rate</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ToggleRate({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={toggleRateAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost">{active ? "Disable" : "Enable"}</SubmitButton>
    </ActionForm>
  );
}

export function AddAmenity() {
  return (
    <ActionForm action={addAmenityAction} resetOnSuccess className="flex items-start gap-2">
      {(s) => (
        <>
          <Input name="name" placeholder="New amenity" className="w-48" required />
          <SubmitButton variant="secondary">Add</SubmitButton>
          {s && !s.ok && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}
