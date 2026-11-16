/* eslint-disable no-console */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { MIGRATIONS_SQL } from "./migrations.generated";
import { seedDatabase } from "@/server/seed";

type PrismaAdapter = NonNullable<NonNullable<ConstructorParameters<typeof PrismaClient>[0]>["adapter"]>;

// In-memory PostgreSQL with the schema and demo data, for running without DATABASE_URL.
// Data lives only as long as the server instance; it starts fresh on every cold start.
export async function startDemoDatabase(): Promise<PrismaClient> {
  const started = Date.now();
  const pg = new PGlite({ extensions: { btree_gist } });
  await pg.exec(MIGRATIONS_SQL);
  // The adapter package is typed against an older driver-adapter-utils; the runtime contract matches.
  const adapter = new PrismaPGlite(pg) as unknown as PrismaAdapter;
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);
  console.log(`Demo database ready in ${Date.now() - started} ms`);
  return prisma;
}
