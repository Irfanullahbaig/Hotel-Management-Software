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
