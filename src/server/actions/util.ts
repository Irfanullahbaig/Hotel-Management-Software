import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { businessToday, parseDateOnly } from "@/lib/dates";
import { AuthError, can, requireProperty } from "@/server/auth/context";
import { clientInfo } from "@/server/auth/session";
import { BusinessError, type Actor } from "@/server/services/common";
import type { ActionState } from "./types";

export function toMessage(e: unknown): string {
  if (e instanceof BusinessError || e instanceof AuthError) return e.message;
  if (e instanceof ZodError) return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join(" · ");
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "A record with these details already exists.";
    if (e.code === "P2025") return "The record no longer exists.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("reservation_rooms_no_overlap")) return "That room is already booked for those dates.";
  if (msg.includes("unbalanced")) return "The accounting entry did not balance, so nothing was saved.";
  if (msg.includes("Books are closed")) return "The books are closed for that date. Nothing was saved.";
  if (msg.includes("stock_levels_non_negative")) return "There is not enough stock at that location.";
  if (msg.includes("event_bookings_no_overlap")) return "That venue is already booked at that time.";
  if (msg.includes("supplier_bills_paid")) return "The payment is more than the amount still owed on the bill.";
  if (msg.includes("NEXT_REDIRECT")) throw e;
  console.error(e);
  return "Something went wrong. Nothing was saved. Please try again.";
}

type Ctx = Awaited<ReturnType<typeof requireProperty>> & { actor: Actor; today: Date };

/** Authenticate, authorise, and run a mutation in one serializable-safe transaction. */
export async function mutate(
  permission: string | string[],
  fn: (tx: Tx, ctx: Ctx) => Promise<ActionState | void>,
): Promise<ActionState> {
  try {
    const auth = await requireProperty();
    const needed = Array.isArray(permission) ? permission : [permission];
    for (const p of needed) if (!can(auth, p)) throw new AuthError();
    const { ip } = await clientInfo();
    const ctx: Ctx = { ...auth, actor: { userId: auth.user.id, propertyId: auth.property.id, ip }, today: businessToday(auth.property.timeZone) };
    const result = await prisma.$transaction((tx) => fn(tx, ctx), { timeout: 20000, maxWait: 10000 });
    return result ?? { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

const empty = (v: unknown) => (v === "" || v === null ? undefined : v);
export const zs = {
  str: z.preprocess(empty, z.string().trim().max(500).optional()),
  req: (label: string) => z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(200),
  text: z.preprocess(empty, z.string().trim().max(4000).optional()),
  email: z.preprocess(empty, z.string().trim().toLowerCase().email("Enter a valid email").optional()),
  int: (min = 0, max = 1000) => z.coerce.number().int().min(min).max(max),
  money: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().min(0).max(100_000_000)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date").transform(parseDateOnly),
  bool: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
};

export const formObject = (fd: FormData) => Object.fromEntries(fd.entries());

export const zx = {
  optDate: z.preprocess((v) => (v === "" || v == null ? undefined : v), zs.date.optional()),
  method: z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "CHEQUE", "ONLINE"], { message: "Choose a payment method" }),
  optMethod: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["CASH", "CARD", "BANK_TRANSFER", "MOBILE_WALLET", "CHEQUE", "ONLINE"]).optional()),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  num: (min = 0, max = 100_000_000) => z.coerce.number().min(min).max(max),
  optNum: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional()),
  /** "HH:MM" → minutes after midnight. */
  clock: z.string().regex(/^\d{1,2}:\d{2}$/, "Enter a time").transform((v) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; }),
};

/** Repeated fields from a LinesForm, zipped into row objects. */
export function lines(fd: FormData, cols: string[]) {
  const arrays = cols.map((c) => fd.getAll(c).map(String));
  const n = Math.max(0, ...arrays.map((a) => a.length));
  return Array.from({ length: n }, (_, i) => Object.fromEntries(cols.map((c, j) => [c, arrays[j][i] ?? ""])));
}
