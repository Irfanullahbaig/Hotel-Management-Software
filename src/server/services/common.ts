import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

export type Actor = { userId: string | null; propertyId: string; ip?: string | null };

/** A rule violation that should be shown to the user verbatim. */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessError";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BusinessError(message);
}

/** Serialize booking-affecting work per property so availability checks cannot race. */
export async function lockProperty(tx: Tx, propertyId: string, scope = "inventory") {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope + ":" + propertyId}))`;
}

export async function nextNumber(tx: Tx, propertyId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("propertyId", "key", "value") VALUES (${propertyId}, ${key}, 1)
    ON CONFLICT ("propertyId", "key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

export const pad = (n: number, width = 6) => String(n).padStart(width, "0");

export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  data?: { before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      propertyId: actor.propertyId,
      userId: actor.userId,
      action,
      entityType,
      entityId,
      summary,
      ip: actor.ip ?? null,
      before: data?.before === undefined ? undefined : (JSON.parse(JSON.stringify(data.before)) as Prisma.InputJsonValue),
      after: data?.after === undefined ? undefined : (JSON.parse(JSON.stringify(data.after)) as Prisma.InputJsonValue),
    },
  });
}

export async function notify(
  tx: Tx,
  propertyId: string,
  n: { type: string; title: string; body?: string; link?: string; userId?: string | null },
) {
  await tx.notification.create({ data: { propertyId, ...n, userId: n.userId ?? null } });
}

/** Returns true the first time a key is claimed; false if it was already used. */
export async function claimIdempotencyKey(tx: Tx, key: string, scope: string) {
  const existing = await tx.idempotencyKey.findUnique({ where: { key } });
  if (existing) {
    if (existing.scope !== scope) throw new BusinessError("Idempotency key reused for a different operation.");
    return { fresh: false as const, resultId: existing.resultId };
  }
  await tx.idempotencyKey.create({ data: { key, scope } });
  return { fresh: true as const, resultId: null };
}

export async function completeIdempotencyKey(tx: Tx, key: string, resultId: string) {
  await tx.idempotencyKey.update({ where: { key }, data: { resultId } });
}
