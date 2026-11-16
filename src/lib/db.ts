import { PrismaClient } from "@prisma/client";

// With DATABASE_URL set, the app talks to that PostgreSQL database.
// Without it, src/instrumentation.ts starts a built-in in-memory PostgreSQL
// (PGlite) with demo data and stores its client here before any request runs.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    if (!process.env.DATABASE_URL) throw new Error("Demo database is not ready yet");
    globalForPrisma.prisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  }
  return globalForPrisma.prisma;
}

// Resolved on each use so the demo client created at startup is always picked up.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
