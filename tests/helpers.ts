import { PrismaClient } from "@prisma/client";
import { bootstrapProperty } from "@/server/services/setup";
import { businessToday } from "@/lib/dates";

if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Tests truncate every table. Point DATABASE_URL at a database whose name ends in _test.");
}
export const prisma = new PrismaClient();
export const today = businessToday("UTC");

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`ALTER TABLE "JournalLine" DISABLE TRIGGER journal_lines_immutable`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "JournalEntry" DISABLE TRIGGER journal_entries_no_delete`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "JournalLine" ENABLE TRIGGER journal_lines_immutable`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "JournalEntry" ENABLE TRIGGER journal_entries_no_delete`);
}

export async function setupProperty() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Test Hotel", code: "TST", taxRate: 10, serviceChargeRate: 5 },
  });
  await prisma.$transaction((tx) => bootstrapProperty(tx, property.id));
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `u${Date.now()}@t.local`, name: "Tester", passwordHash: "x" } });
  const std = await prisma.roomType.create({
    data: { propertyId: property.id, code: "STD", name: "Standard", basePrice: 100, maxOccupancy: 3, maxAdults: 3, maxChildren: 1, extraAdultCharge: 20 },
  });
  const rooms = [];
  for (const n of ["101", "102"]) rooms.push(await prisma.room.create({ data: { propertyId: property.id, roomTypeId: std.id, number: n, floor: 1 } }));
  return { org, property, user, std, rooms, actor: { userId: user.id, propertyId: property.id } };
}

export async function balances(propertyId: string) {
  const rows = await prisma.$queryRaw<{ code: string; net: string }[]>`
    SELECT a.code, COALESCE(SUM(l.debit - l.credit), 0)::text AS net
    FROM "Account" a LEFT JOIN "JournalLine" l ON l."accountId" = a.id
    WHERE a."propertyId" = ${propertyId} GROUP BY a.code`;
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.net)]));
}
