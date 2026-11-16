// Runs once per server instance before it handles requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DATABASE_URL) return;
  const g = globalThis as unknown as { prisma?: unknown };
  if (g.prisma) return;
  const { startDemoDatabase } = await import("./server/demo/database");
  g.prisma = await startDemoDatabase();
}
