"use client";

import { ActionForm, Dialog, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { createPayrollAction, payPayrollAction, updatePayrollItemAction } from "@/server/actions/payroll";

export function CreatePayrollDialog({ defaultMonth }: { defaultMonth: string }) {
  return (
    <Dialog title="Prepare payroll" description="Pay is calculated from each employee's salary, attendance and approved leave. You can adjust allowances and withholding before approval." trigger={(open) => <Button onClick={open}>+ Prepare payroll</Button>}>
      {(close) => (
        <ActionForm action={createPayrollAction} onSuccess={close} className="grid gap-3">
          {(s) => (
            <>
              <Field label="Month" required><Input type="month" name="month" defaultValue={defaultMonth} required /></Field>
              <Field label="Notes"><Input name="notes" /></Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton pendingText="Calculating…">Prepare</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function PayrollItemDialog({ item, name, currency }: { item: { id: string; allowances: string; withholding: string; note: string | null; gross: string }; name: string; currency: string }) {
  return (
    <Dialog title={`Adjust pay: ${name}`} trigger={(open) => <Button size="sm" variant="ghost" onClick={open}>Adjust</Button>}>
      {(close) => (
        <ActionForm action={updatePayrollItemAction} onSuccess={close} className="grid grid-cols-2 gap-3">
          {(s) => (
            <>
              <input type="hidden" name="itemId" value={item.id} />
              <Field label={`Allowances / bonus (${currency})`}><Input type="number" min="0" step="0.01" name="allowances" defaultValue={item.allowances} /></Field>
              <Field label={`Tax & statutory withholding (${currency})`} hint="Credited to Taxes Payable"><Input type="number" min="0" step="0.01" name="withholding" defaultValue={item.withholding} /></Field>
              <Field label="Note (shown on payslip)" className="col-span-2"><Input name="note" defaultValue={item.note ?? ""} /></Field>
              <div className="col-span-2"><FormMessage state={s} /></div>
              <div className="col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Save</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

export function PayPayrollDialog({ runId, total }: { runId: string; total: string }) {
  return (
    <Dialog title="Pay staff" description={`Records payment of ${total} net pay and posts it to the ledger (Dr Salaries Payable, Cr Cash/Bank).`} trigger={(open) => <Button onClick={open}>Mark as paid</Button>}>
      {(close) => (
        <ActionForm action={payPayrollAction} onSuccess={close} className="grid gap-3">
          {(s) => (
            <>
              <input type="hidden" name="runId" value={runId} />
              <Field label="Paid by">
                <Select name="method" defaultValue="BANK_TRANSFER"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option></Select>
              </Field>
              <FormMessage state={s} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><SubmitButton>Confirm payment</SubmitButton></div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}
