"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import type { ActionState } from "@/server/actions/types";

export function CheckOutForm({ reservationId, balance, currency, canPay, canAllowBalance, action }: { reservationId: string; balance: number; currency: string; canPay: boolean; canAllowBalance: boolean; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "0");
  const [allow, setAllow] = useState(false);
  const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v);
  const remaining = Math.round((balance - Number(amount || 0)) * 100) / 100;
  return (
    <ActionForm action={action} className="space-y-3" confirm="Complete check-out? The invoice will be issued and the room released to housekeeping.">
      {(s) => (
        <>
          <input type="hidden" name="reservationId" value={reservationId} />
          {balance > 0 && canPay ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount received"><Input name="paymentAmount" type="number" step="0.01" min="0" max={balance.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Method"><Select name="paymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CHEQUE">Cheque</option></Select></Field>
              </div>
              <Field label="Reference"><Input name="paymentReference" placeholder="Card slip / transfer ref." /></Field>
            </>
          ) : (
            <><input type="hidden" name="paymentAmount" value="0" /><input type="hidden" name="paymentMethod" value="CASH" /></>
          )}
          {balance < 0 && <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">The guest has overpaid by {money(-balance)}. It will be refunded in cash and recorded on the invoice.</p>}
          {remaining > 0.004 && (
            canAllowBalance
              ? <Checkbox name="allowBalance" checked={allow} onChange={(e) => setAllow(e.target.checked)} label={`Leave ${money(remaining)} outstanding on the guest ledger`} />
              : <p className="text-xs text-warn">{money(remaining)} would remain unpaid. Only a manager can check out with a balance.</p>
          )}
          <FormMessage state={s} />
          <SubmitButton className="w-full" pendingText="Checking out…" disabled={remaining > 0.004 && !allow}>Check out & issue invoice</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
