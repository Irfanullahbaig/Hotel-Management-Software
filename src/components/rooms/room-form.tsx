"use client";

import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { bulkCreateRoomsAction, saveRoomAction } from "@/server/actions/rooms";

type RoomLike = { id: string; number: string; name: string | null; roomTypeId: string; floor: number; building: string | null; description: string | null; isActive: boolean };

export function RoomForm({ room, types }: { room?: RoomLike; types: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveRoomAction} className="flex flex-col gap-3">
      {(s) => (
        <>
          {room && <input type="hidden" name="id" value={room.id} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room number" required><Input name="number" defaultValue={room?.number} required /></Field>
            <Field label="Floor" required><Input name="floor" type="number" defaultValue={room?.floor ?? 1} required /></Field>
          </div>
          <Field label="Room type" required>
            <Select name="roomTypeId" defaultValue={room?.roomTypeId} required>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (optional)"><Input name="name" defaultValue={room?.name ?? ""} placeholder="e.g. Lake Suite" /></Field>
            <Field label="Building / wing"><Input name="building" defaultValue={room?.building ?? ""} /></Field>
          </div>
          <Field label="Description"><Textarea name="description" defaultValue={room?.description ?? ""} /></Field>
          <Checkbox name="isActive" defaultChecked={room?.isActive ?? true} label="Active (sellable)" />
          <FormMessage state={s} />
          <SubmitButton>{room ? "Save room" : "Create room"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function BulkRoomForm({ types }: { types: { id: string; name: string }[] }) {
  return (
    <ActionForm action={bulkCreateRoomsAction} className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="Room type" required>
            <Select name="roomTypeId" required>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor" required><Input name="floor" type="number" defaultValue={1} required /></Field>
            <Field label="Building / wing"><Input name="building" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Prefix" hint="optional"><Input name="prefix" placeholder="A-" /></Field>
            <Field label="From number" required><Input name="from" type="number" defaultValue={501} required /></Field>
            <Field label="To number" required><Input name="to" type="number" defaultValue={510} required /></Field>
          </div>
          <FormMessage state={s} />
          <SubmitButton>Create rooms</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
