"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Dialog, FormMessage, SubmitButton } from "./action-form";
import { Button } from "./button";
import { Checkbox, Field, Input, Select, Textarea } from "./form";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/server/actions/types";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Variant = "primary" | "secondary" | "danger" | "ghost" | "danger-outline";
export type Opt = [value: string, label: string];

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "datetime-local" | "email" | "select" | "textarea" | "checkbox" | "hidden";
  options?: Opt[];
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  step?: string;
  min?: string | number;
  max?: string | number;
  span?: 1 | 2 | 3 | 4;
  hint?: string;
  placeholder?: string;
  /** For selects: an initial empty option label. */
  empty?: string;
};

const spanClass = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4" } as const;

function Fields({ fields }: { fields: FieldSpec[] }) {
  return (
    <>
      {fields.map((f) => {
        const dv = f.defaultValue == null ? undefined : String(f.defaultValue);
        if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} value={dv ?? ""} />;
        const span = spanClass[f.span ?? (f.type === "textarea" ? 4 : 2)];
        if (f.type === "checkbox") {
          return <div key={f.name} className={cn("flex items-end pb-2", span)}><Checkbox name={f.name} label={f.label} defaultChecked={!!f.defaultValue} /></div>;
        }
        let control: React.ReactNode;
        if (f.type === "select") {
          control = (
            <Select name={f.name} defaultValue={dv ?? ""} required={f.required}>
              {(f.empty !== undefined || !f.required) && <option value="">{f.empty ?? "—"}</option>}
              {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          );
        } else if (f.type === "textarea") {
          control = <Textarea name={f.name} defaultValue={dv} required={f.required} rows={3} placeholder={f.placeholder} />;
        } else {
          control = (
            <Input
              name={f.name} type={f.type ?? "text"} defaultValue={dv} required={f.required} placeholder={f.placeholder}
              step={f.step ?? (f.type === "number" ? "0.01" : undefined)} min={f.min ?? (f.type === "number" ? 0 : undefined)} max={f.max}
            />
          );
        }
        return <Field key={f.name} label={f.label} required={f.required} hint={f.hint} className={span}>{control}</Field>;
      })}
    </>
  );
}

/** A trigger button that opens a dialog with a generated form. */
export function FormDialog({
  action, title, description, trigger, fields, submitLabel = "Save", triggerVariant = "primary", triggerSize = "sm", wide, confirm, children,
}: {
  action: Action; title: string; description?: string; trigger: string; fields: FieldSpec[]; submitLabel?: string;
  triggerVariant?: Variant; triggerSize?: "sm" | "md"; wide?: boolean; confirm?: string; children?: React.ReactNode;
}) {
  return (
    <Dialog
      title={title} description={description} wide={wide}
      trigger={(open) => <Button type="button" variant={triggerVariant} size={triggerSize} onClick={open}>{trigger}</Button>}
    >
      {(close) => (
        <ActionForm action={action} confirm={confirm} onSuccess={close} className="grid gap-3 sm:grid-cols-4">
          {(s) => (
            <>
              <Fields fields={fields} />
              {children && <div className="sm:col-span-4">{children}</div>}
              <div className="sm:col-span-4">{s && <FormMessage state={s} />}</div>
              <div className="flex justify-end gap-2 sm:col-span-4">
                <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
                <SubmitButton>{submitLabel}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </Dialog>
  );
}

/** The same generated form, rendered in place (e.g. inside a card). */
export function InlineForm({ action, fields, submitLabel = "Save", resetOnSuccess = true, confirm, className }: { action: Action; fields: FieldSpec[]; submitLabel?: string; resetOnSuccess?: boolean; confirm?: string; className?: string }) {
  return (
    <ActionForm action={action} resetOnSuccess={resetOnSuccess} confirm={confirm} className={cn("grid gap-3 sm:grid-cols-4", className)}>
      {(s) => (
        <>
          <Fields fields={fields} />
          <div className="flex items-center justify-end gap-3 sm:col-span-4">
            {s && <div className="flex-1"><FormMessage state={s} /></div>}
            <SubmitButton>{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** A single button posting hidden fields (optionally asking for confirmation). */
export function PostButton({ action, fields, label, variant = "secondary", size = "sm", confirm, pendingText }: {
  action: Action; fields: Record<string, string>; label: string; variant?: Variant; size?: "sm" | "md"; confirm?: string; pendingText?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-flex flex-col items-end gap-1">
      {(s) => (
        <>
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <SubmitButton size={size} variant={variant} pendingText={pendingText ?? "…"}>{label}</SubmitButton>
          {s && !s.ok && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}

export type LineColumn = { name: string; label: string; type: "select" | "number" | "text"; options?: Opt[]; width?: string; step?: string; defaultValue?: string };

/** Header fields plus a growable table of lines. Each line column posts as a repeated form field. */
export function LinesForm({
  action, fields, columns, initialRows = 2, submitLabel = "Save", addLabel = "Add line", footer,
}: {
  action: Action; fields: FieldSpec[]; columns: LineColumn[]; initialRows?: number | Record<string, string>[]; submitLabel?: string; addLabel?: string; footer?: (rows: Record<string, string>[]) => React.ReactNode;
}) {
  const blank = () => Object.fromEntries(columns.map((c) => [c.name, c.defaultValue ?? ""]));
  const [rows, setRows] = useState<Record<string, string>[]>(() => (Array.isArray(initialRows) ? initialRows : Array.from({ length: initialRows }, blank)));
  const set = (i: number, k: string, v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-4">
      {(s) => (
        <>
          <Fields fields={fields} />
          <div className="overflow-x-auto sm:col-span-4">
            <table className="w-full text-sm">
              <thead><tr>{columns.map((c) => <th key={c.name} className="px-1 pb-1 text-left text-xs font-medium text-ink-3" style={{ width: c.width }}>{c.label}</th>)}<th className="w-8" /></tr></thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.name} className="px-1 py-1">
                        {c.type === "select" ? (
                          <Select name={c.name} value={row[c.name]} onChange={(e) => set(i, c.name, e.target.value)} aria-label={c.label}>
                            <option value="">—</option>
                            {c.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </Select>
                        ) : (
                          <Input name={c.name} type={c.type} step={c.step ?? (c.type === "number" ? "0.01" : undefined)} min={c.type === "number" ? 0 : undefined} value={row[c.name]} onChange={(e) => set(i, c.name, e.target.value)} aria-label={c.label} />
                        )}
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      <button type="button" className="rounded p-1.5 text-ink-3 hover:bg-muted hover:text-danger" aria-label="Remove line" onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : r))}><Trash2 className="size-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setRows((r) => [...r, blank()])}><Plus className="size-4" /> {addLabel}</Button>
          </div>
          {footer && <div className="sm:col-span-4">{footer(rows)}</div>}
          <div className="flex items-center justify-end gap-3 sm:col-span-4">
            {s && <div className="flex-1"><FormMessage state={s} /></div>}
            <SubmitButton>{submitLabel}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
