"use client";

import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Select } from "@/components/ui/form";
import { assignTaskAction, taskProgressAction } from "@/server/actions/housekeeping";

export function AssignSelect({ taskId, assigneeId, staff }: { taskId: string; assigneeId: string | null; staff: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignTaskAction} className="flex items-center gap-1.5">
      {(s) => (
        <>
          <input type="hidden" name="taskId" value={taskId} />
          <Select name="assigneeId" defaultValue={assigneeId ?? ""} className="h-8 w-40 text-xs" aria-label="Assign to">
            <option value="">Unassigned</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
          {s && !s.ok && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}

export function StepButton({ taskId, step, label, variant = "primary" }: { taskId: string; step: string; label: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={taskProgressAction}>
      {(s) => (
        <>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="step" value={step} />
          <SubmitButton size="sm" variant={variant}>{label}</SubmitButton>
          {s && !s.ok && <FormMessage state={s} />}
        </>
      )}
    </ActionForm>
  );
}
