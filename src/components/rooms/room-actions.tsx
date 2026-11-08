"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { blockRoomAction, housekeepingStatusAction, releaseRoomAction } from "@/server/actions/rooms";

const NEXT: Record<string, { to: string; label: string }[]> = {
  DIRTY: [{ to: "CLEANING_IN_PROGRESS", label: "Start cleaning" }, { to: "CLEAN", label: "Mark cleaned" }],
  CLEANING_ASSIGNED: [{ to: "CLEANING_IN_PROGRESS", label: "Start cleaning" }],
  CLEANING_IN_PROGRESS: [{ to: "CLEAN", label: "Mark cleaned" }],
  CLEAN: [{ to: "INSPECTED", label: "Pass inspection" }, { to: "DIRTY", label: "Fail inspection" }],
  INSPECTED: [{ to: "DIRTY", label: "Mark dirty" }],
};

export function RoomActions({ roomId, hk, service, today }: { roomId: string; hk: string; service: string; today: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(NEXT[hk] ?? []).map((n) => (
        <ActionForm key={n.to} action={housekeepingStatusAction}>
          {(s) => (
            <>
              <input type="hidden" name="roomId" value={roomId} />
              <input type="hidden" name="status" value={n.to} />
              <SubmitButton variant={n.to === "DIRTY" ? "secondary" : "primary"} size="sm">{n.label}</SubmitButton>
              {s && !s.ok && <FormMessage state={s} />}
            </>
          )}
        </ActionForm>
      ))}
      {service === "IN_SERVICE" ? (
        <Dialog title="Take room out of inventory" description="The room cannot be sold or assigned while blocked." trigger={(open) => <Button variant="secondary" size="sm" onClick={open}>Block / maintenance</Button>}>
          {(close) => (
            <ActionForm action={blockRoomAction} onSuccess={close} className="flex flex-col gap-3">
              {(s) => (
                <>
                  <input type="hidden" name="roomId" value={roomId} />
                  <Field label="Type">
                    <Select name="kind" defaultValue="UNDER_MAINTENANCE">
                      <option value="UNDER_MAINTENANCE">Under maintenance</option>
                      <option value="OUT_OF_SERVICE">Out of service</option>
                      <option value="BLOCKED">Blocked</option>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From"><Input type="date" name="startDate" defaultValue={today} required /></Field>
                    <Field label="Until (exclusive)"><Input type="date" name="endDate" required /></Field>
                  </div>
                  <Field label="Reason" required><Textarea name="reason" required placeholder="e.g. AC unit leaking" /></Field>
                  <FormMessage state={s} />
                  <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Block room</SubmitButton></div>
                </>
              )}
            </ActionForm>
          )}
        </Dialog>
      ) : (
        <ActionForm action={releaseRoomAction} confirm="Return this room to service? It will need inspection before it can be sold.">
          {(s) => (
            <>
              <input type="hidden" name="roomId" value={roomId} />
              <SubmitButton variant="secondary" size="sm">Return to service</SubmitButton>
              {s && !s.ok && <FormMessage state={s} />}
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
