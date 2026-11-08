"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { ActionState } from "@/server/actions/types";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, pendingText, variant, size, className, disabled }: { children: React.ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger" | "ghost" | "danger-outline"; size?: "sm" | "md" | "lg"; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state || (!state.error && !state.message)) return null;
  return (
    <div role={state.ok ? "status" : "alert"} className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", state.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger")}>
      {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
      <span>{state.ok ? state.message : state.error}</span>
    </div>
  );
}

/**
 * Wraps a server action with pending, error and success handling.
 * A fresh idempotency key is generated per form mount and rotated after success,
 * so double-submits of the same attempt are de-duplicated server-side.
 */
export function ActionForm({
  action, children, className, onSuccess, resetOnSuccess, confirm,
}: {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  children: React.ReactNode | ((state: ActionState) => React.ReactNode);
  className?: string;
  onSuccess?: (state: NonNullable<ActionState>) => void;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [key, setKey] = useState("");
  useEffect(() => setKey(crypto.randomUUID()), []);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      setKey(crypto.randomUUID());
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}

export function Dialog({ trigger, title, description, children, wide }: { trigger: (open: () => void) => React.ReactNode; title: string; description?: string; children: (close: () => void) => React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className={cn("m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/30", wide ? "max-w-2xl" : "max-w-md")}
      >
        {open && (
          <div className="p-5">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
            <div className="mt-4">{children(() => setOpen(false))}</div>
          </div>
        )}
      </dialog>
    </>
  );
}
