"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { cancelReservationAction, changeDatesAction, moveRoomAction, recordPaymentAction, updateReservationAction } from "@/server/actions/reservations";

const METHODS = [["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["MOBILE_WALLET", "Mobile wallet"], ["CHEQUE", "Cheque"], ["ONLINE", "Online"]];
const SOURCES = [["DIRECT", "Direct"], ["PHONE", "Phone"], ["WALK_IN", "Walk-in"], ["WEBSITE", "Website"], ["TRAVEL_AGENT", "Travel agent"], ["CORPORATE", "Corporate"], ["BOOKING_COM", "Booking.com"], ["EXPEDIA", "Expedia"], ["AGODA", "Agoda"], ["AIRBNB", "Airbnb"], ["OTHER_OTA", "Other OTA"]];

export function PaymentDialog({ reservationId, suggested, label = "Record payment" }: { reservationId: string; suggested: string; label?: string }) {
  return (
    <Dialog title="Record payment" description="Before check-in this is held as a guest deposit; after check-in it settles the folio." trigger={(open) => <Button variant="secondary" onClick={open}>{label}</Button>}>
      {(close) => (
        <ActionForm action={recordPaymentAction} onSuccess={close} className="flex flex-col gap-3">
          {(s) => (
            <>
              <input type="hidden" name="reservationId" value={reservationId} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount" required><Input name="amount" type="number" step="0.01" min="0.01" defaultValue={Number(suggested) > 0 ? suggested : ""} required autoFocus /></Field>
                <Field label="Method"><Select name="method">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              </div>
              <Field label="Reference"><Input name="reference" placeholder="Card slip, transfer ID…" /></Field>
              <Field label="Notes"><Input name="notes" /></Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Record payment</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function DatesDialog({ id, checkIn, checkOut, inHouse }: { id: string; checkIn: string; checkOut: string; inHouse: boolean }) {
  return (
    <Dialog title={inHouse ? "Extend or shorten stay" : "Change dates"} description="Availability is re-checked. Nights already charged keep their rate; new nights use current rates." trigger={(open) => <Button variant="secondary" onClick={open}>{inHouse ? "Extend / shorten" : "Change dates"}</Button>}>
      {(close) => (
        <ActionForm action={changeDatesAction} onSuccess={close} className="flex flex-col gap-3">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check-in"><Input type="date" name="checkIn" defaultValue={checkIn} readOnly={inHouse} /></Field>
                <Field label="Check-out"><Input type="date" name="checkOut" defaultValue={checkOut} /></Field>
              </div>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save dates</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function MoveRoomDialog({ lineId, current, rooms, label }: { lineId: string; current: string | null; rooms: { id: string; label: string }[]; label: string }) {
  return (
    <Dialog title={current ? "Change room" : "Assign room"} description="Only rooms free for the whole stay are listed. Upgrades keep the booked rate." trigger={(open) => <Button variant="ghost" size="sm" onClick={open}>{label}</Button>}>
      {(close) => (
        <ActionForm action={moveRoomAction} onSuccess={close} className="flex flex-col gap-3">
          {(s) => (
            <>
              <input type="hidden" name="lineId" value={lineId} />
              <Field label="Room">
                <Select name="roomId" defaultValue={current ?? ""}>
                  <option value="">Unassigned</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditDetailsDialog({ r, canDiscount }: { r: { id: string; source: string; specialRequests: string | null; notes: string | null; companyName: string | null; groupName: string | null; discount: string; status: string }; canDiscount: boolean }) {
  return (
    <Dialog wide title="Edit reservation" trigger={(open) => <Button variant="secondary" onClick={open}>Edit</Button>}>
      {(close) => (
        <ActionForm action={updateReservationAction} onSuccess={close} className="grid gap-3 sm:grid-cols-2">
          {(s) => (
            <>
              <input type="hidden" name="id" value={r.id} />
              <Field label="Source"><Select name="source" defaultValue={r.source}>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              {(r.status === "PENDING" || r.status === "CONFIRMED") && (
                <Field label="Status"><Select name="status" defaultValue={r.status}><option value="CONFIRMED">Confirmed</option><option value="PENDING">Pending</option></Select></Field>
              )}
              <Field label="Company"><Input name="companyName" defaultValue={r.companyName ?? ""} /></Field>
              <Field label="Group name"><Input name="groupName" defaultValue={r.groupName ?? ""} /></Field>
              <Field label="Discount (before tax)" hint={canDiscount ? undefined : "Requires rate override permission"}><Input name="discount" type="number" step="0.01" min="0" defaultValue={r.discount} readOnly={!canDiscount} /></Field>
              <div />
              <Field label="Special requests"><Textarea name="specialRequests" defaultValue={r.specialRequests ?? ""} /></Field>
              <Field label="Internal notes"><Textarea name="notes" defaultValue={r.notes ?? ""} /></Field>
              <div className="sm:col-span-2"><FormMessage state={s} /></div>
              <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save changes</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function CancelDialog({ id, held, policy, canRefund }: { id: string; held: string; policy: string | null; canRefund: boolean }) {
  return (
    <Dialog title="Cancel reservation" description={policy ?? undefined} trigger={(open) => <Button variant="danger-outline" onClick={open}>Cancel booking</Button>}>
      {(close) => (
        <ActionForm action={cancelReservationAction} onSuccess={close} className="flex flex-col gap-3" confirm="Cancel this reservation? This releases the rooms and cannot be undone.">
          {(s) => (
            <>
              <input type="hidden" name="id" value={id} />
              <Field label="Reason" required><Textarea name="reason" required /></Field>
              <p className="text-sm text-ink-2">Deposit held: <strong>{held}</strong>. Any amount not refunded is kept as a cancellation fee.</p>
              {canRefund ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Refund amount"><Input name="refundAmount" type="number" step="0.01" min="0" max={held} defaultValue={held} /></Field>
                  <Field label="Refund method"><Select name="refundMethod">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                </div>
              ) : <><input type="hidden" name="refundAmount" value="0" /><input type="hidden" name="refundMethod" value="CASH" /></>}
              <Checkbox name="noShow" label="Guest did not arrive (record as no-show)" />
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Keep booking</Button><SubmitButton variant="danger">Cancel reservation</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}
