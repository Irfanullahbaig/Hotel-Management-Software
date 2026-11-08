"use client";

import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

type Line = { id: string; type: string; assignedRoomId: string | null; assignedReady: boolean; adults: number; children: number; rooms: { id: string; number: string; sameType: boolean }[] };

export function CheckInForm({ reservationId, lines, doc, specialRequests, suggestedPayment, canPay, action }: {
  reservationId: string; lines: Line[]; doc: { type: string; number: string; verified: boolean } | null; specialRequests: string | null; suggestedPayment: string; canPay: boolean;
  action: (s: import("@/server/actions/types").ActionState, f: FormData) => Promise<import("@/server/actions/types").ActionState>;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 lg:grid-cols-3">
      {(s) => (
        <>
          <input type="hidden" name="reservationId" value={reservationId} />
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader title="1. Assign rooms" description="Only vacant, inspected rooms free for the whole stay are offered." />
              <CardBody className="space-y-3">
                {lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-2 items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-12">
                    <input type="hidden" name="lineId" value={l.id} />
                    <div className="col-span-2 sm:col-span-3"><Checkbox name={`include_${l.id}`} defaultChecked label={<span className="font-medium">{l.type}</span>} /></div>
                    <Field label="Room" className="col-span-2 sm:col-span-5">
                      <Select name={`room_${l.id}`} defaultValue={l.assignedReady ? l.assignedRoomId ?? "" : ""}>
                        <option value="">Select a ready room…</option>
                        {l.rooms.map((r) => <option key={r.id} value={r.id}>{r.number}{r.sameType ? "" : " (upgrade / different type)"}</option>)}
                      </Select>
                      {l.assignedRoomId && !l.assignedReady && <span className="text-xs text-warn">The pre-assigned room is not ready; choose another or have it inspected.</span>}
                      {l.rooms.length === 0 && <span className="text-xs text-danger">No ready rooms. Check the housekeeping board.</span>}
                    </Field>
                    <Field label="Adults" className="sm:col-span-2"><Input name={`adults_${l.id}`} type="number" min={1} defaultValue={l.adults} /></Field>
                    <Field label="Children" className="sm:col-span-2"><Input name={`children_${l.id}`} type="number" min={0} defaultValue={l.children} /></Field>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="2. Verify identification" />
              <CardBody className="grid gap-3 sm:grid-cols-4">
                {doc && <p className="text-sm text-ink-2 sm:col-span-4">On file: {doc.type.toLowerCase().replace("_", " ")} ending {doc.number.slice(-4)} {doc.verified ? "(verified before)" : ""}. Enter a document only if it differs.</p>}
                <Field label="ID type"><Select name="docType" defaultValue="PASSPORT"><option value="PASSPORT">Passport</option><option value="NATIONAL_ID">National ID</option><option value="DRIVING_LICENSE">Driving licence</option><option value="OTHER">Other</option></Select></Field>
                <Field label="Number" required={!doc}><Input name="docNumber" required={!doc} /></Field>
                <Field label="Issuing country"><Input name="docCountry" /></Field>
                <Field label="Expiry"><Input name="docExpiry" type="date" /></Field>
                <div className="sm:col-span-4"><Checkbox name="documentVerified" required label="I have checked the guest's identification document in person" /></div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="3. Requests" />
              <CardBody><Textarea name="specialRequests" defaultValue={specialRequests ?? ""} placeholder="Late checkout, extra pillows…" /></CardBody>
            </Card>
          </div>
          <div>
            <Card className="lg:sticky lg:top-20">
              <CardHeader title="4. Deposit" description="Optional. Held as a guest deposit until check-out." />
              <CardBody className="space-y-3">
                {canPay ? (
                  <>
                    <Field label="Amount"><Input name="paymentAmount" type="number" step="0.01" min="0" placeholder={suggestedPayment} /></Field>
                    <Field label="Method"><Select name="paymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CHEQUE">Cheque</option></Select></Field>
                    <Field label="Reference"><Input name="paymentReference" /></Field>
                  </>
                ) : <><input type="hidden" name="paymentAmount" value="0" /><input type="hidden" name="paymentMethod" value="CASH" /><p className="text-sm text-ink-3">You cannot take payments.</p></>}
                <p className="text-xs text-ink-3">Balance before deposit: {suggestedPayment}</p>
                <FormMessage state={s} />
                <SubmitButton className="w-full" pendingText="Checking in…">Complete check-in</SubmitButton>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </ActionForm>
  );
}
