import type { Tx } from "@/lib/db";
import { DEFAULT_CHART } from "./ledger";

/** Everything a new property needs before it can trade: chart of accounts. */
export async function bootstrapProperty(tx: Tx, propertyId: string) {
  for (const a of DEFAULT_CHART) {
    await tx.account.upsert({
      where: { propertyId_code: { propertyId, code: a.code } },
      update: {},
      create: { propertyId, code: a.code, name: a.name, type: a.type, isSystem: true },
    });
  }
}
