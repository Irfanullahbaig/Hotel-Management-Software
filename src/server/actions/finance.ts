"use server";

import { z } from "zod";
import { formObject, lines, mutate, zs, zx } from "./util";
import { can } from "@/server/auth/context";
import { BusinessError } from "@/server/services/common";
import { addAccount, closeBooks, postManualJournal, recordExpense, reopenBooks, reverseEntry, setBudget } from "@/server/services/accounting";
import { paySupplierBill } from "@/server/services/purchasing";
import type { ActionState } from "./types";

type A = Promise<ActionState>;

export async function recordExpenseAction(_: ActionState, fd: FormData): A {
  return mutate("finance.create", async (tx, ctx) => {
    const d = z.object({
      date: zs.date, account: zs.req("Account"), description: zs.req("Description"), amount: zs.money,
      paidBy: z.enum(["CASH", "BANK_TRANSFER", "ON_ACCOUNT"]), supplierId: zs.str, reference: zs.str,
    }).parse(formObject(fd));
    const e = await recordExpense(tx, ctx.actor, d);
    return { ok: true, message: `${e.number} recorded.` };
  });
}

export async function manualJournalAction(_: ActionState, fd: FormData): A {
  return mutate("finance.create", async (tx, ctx) => {
    const d = z.object({ date: zs.date, memo: zs.req("Memo") }).parse(formObject(fd));
    const rows = lines(fd, ["account", "debit", "credit", "lineMemo"]).map((r) => ({ account: r.account, debit: Number(r.debit || 0), credit: Number(r.credit || 0), memo: r.lineMemo || undefined }));
    if (rows.some((r) => r.debit < 0 || r.credit < 0 || Number.isNaN(r.debit) || Number.isNaN(r.credit))) throw new BusinessError("Amounts must be positive numbers.");
    const e = await postManualJournal(tx, ctx.actor, { ...d, lines: rows });
    return { ok: true, message: `Posted ${e.number}.`, redirectTo: "/finance?tab=journal" };
  });
}

export async function reverseEntryAction(_: ActionState, fd: FormData): A {
  return mutate(["finance.edit"], async (tx, ctx) => {
    const d = z.object({ id: zs.req("Entry"), reason: zs.req("Reason"), date: zx.optDate }).parse(formObject(fd));
    const r = await reverseEntry(tx, ctx.actor, d.id, d.date ?? ctx.today, d.reason);
    return { ok: true, message: `Reversed with ${r.number}.` };
  });
}

export async function closeBooksAction(_: ActionState, fd: FormData): A {
  return mutate("finance.approve", async (tx, ctx) => {
    const d = z.object({ through: zs.date }).parse(formObject(fd));
    await closeBooks(tx, ctx.actor, d.through, ctx.today);
    return { ok: true, message: "Books closed." };
  });
}

export async function reopenBooksAction(_: ActionState, fd: FormData): A {
  return mutate("finance.approve", async (tx, ctx) => {
    const d = z.object({ through: zx.optDate }).parse(formObject(fd));
    await reopenBooks(tx, ctx.actor, d.through ?? null);
    return { ok: true, message: "Books reopened." };
  });
}

export async function addAccountAction(_: ActionState, fd: FormData): A {
  return mutate("finance.edit", async (tx, ctx) => {
    const d = z.object({ code: zs.req("Code"), name: zs.req("Name"), type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]) }).parse(formObject(fd));
    await addAccount(tx, ctx.actor, d);
    return { ok: true, message: "Account added." };
  });
}

export async function setBudgetAction(_: ActionState, fd: FormData): A {
  return mutate("finance.edit", async (tx, ctx) => {
    const d = z.object({ year: zs.int(2000, 2100) }).parse(formObject(fd));
    const rows = lines(fd, ["account", "amount"]).filter((r) => r.account);
    for (const r of rows) await setBudget(tx, ctx.actor, { year: d.year, account: r.account, amount: Number(r.amount || 0) });
    return { ok: true, message: `Budget for ${d.year} saved.` };
  });
}

export async function payBillAction(_: ActionState, fd: FormData): A {
  return mutate(["procurement.view"], async (tx, ctx) => {
    if (!can(ctx, "finance.create") && !can(ctx, "procurement.edit")) throw new BusinessError("You are not allowed to pay bills.");
    const d = z.object({ billId: zs.req("Bill"), amount: zs.money, method: zx.method, date: zx.optDate, reference: zs.str }).parse(formObject(fd));
    await paySupplierBill(tx, ctx.actor, { ...d, date: d.date ?? ctx.today });
    return { ok: true, message: "Payment recorded." };
  });
}
