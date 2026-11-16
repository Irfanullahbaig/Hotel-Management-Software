"use server";

import { z } from "zod";
import { formObject, mutate, zs } from "./util";
import {
  approvePayrollRun, createPayrollRun, deletePayrollRun, monthPeriod, payPayrollRun, recalculatePayrollRun, updatePayrollItem,
} from "@/server/services/payroll";
import type { ActionState } from "./types";

export async function createPayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.create", async (tx, ctx) => {
    const d = z.object({ month: zs.req("Month"), notes: zs.str }).parse(formObject(fd));
    const run = await createPayrollRun(tx, ctx.actor, { period: monthPeriod(d.month), notes: d.notes });
    return { ok: true, message: `Payroll ${run.number} prepared.`, redirectTo: `/payroll/${run.id}` };
  });
}

export async function recalculatePayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.edit", async (tx, ctx) => {
    await recalculatePayrollRun(tx, ctx.actor, zs.req("Run").parse(fd.get("runId")));
    return { ok: true, message: "Recalculated from the latest salaries, attendance and leave." };
  });
}

export async function updatePayrollItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.edit", async (tx, ctx) => {
    const d = z.object({ itemId: zs.req("Item"), allowances: zs.money, withholding: zs.money, note: zs.str }).parse(formObject(fd));
    await updatePayrollItem(tx, ctx.actor, d);
    return { ok: true, message: "Saved." };
  });
}

export async function deletePayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.delete", async (tx, ctx) => {
    await deletePayrollRun(tx, ctx.actor, zs.req("Run").parse(fd.get("runId")));
    return { ok: true, message: "Draft deleted.", redirectTo: "/payroll" };
  });
}

export async function approvePayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.approve", async (tx, ctx) => {
    await approvePayrollRun(tx, ctx.actor, zs.req("Run").parse(fd.get("runId")), ctx.today);
    return { ok: true, message: "Payroll approved and posted to the ledger." };
  });
}

export async function payPayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("payroll.approve", async (tx, ctx) => {
    const d = z.object({ runId: zs.req("Run"), method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE"]) }).parse(formObject(fd));
    await payPayrollRun(tx, ctx.actor, { runId: d.runId, method: d.method, today: ctx.today });
    return { ok: true, message: "Payroll marked as paid and posted to the ledger." };
  });
}
