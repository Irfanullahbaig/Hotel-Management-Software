"use client";
import { MoonStar } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { nightAuditAction } from "@/server/actions/frontdesk";

export function NightAuditButton() {
  return (
    <ActionForm action={nightAuditAction} confirm="Run the night audit? Tonight's room charges will be posted to every in-house folio." className="flex items-center gap-2">
      {(s) => (<><SubmitButton variant="secondary" pendingText="Posting…"><MoonStar className="size-4" /> Night audit</SubmitButton>{s && <div className="max-w-xs"><FormMessage state={s} /></div>}</>)}
    </ActionForm>
  );
}
