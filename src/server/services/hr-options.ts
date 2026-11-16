import "server-only";
import { prisma } from "@/lib/db";

/** Select options for the employee form. Logins already linked to another employee are excluded. */
export async function employeeFormOptions(propertyId: string, employeeId?: string) {
  const [departments, shifts, users] = await Promise.all([
    prisma.department.findMany({ where: { propertyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.shift.findMany({ where: { propertyId, isActive: true }, orderBy: { startMinute: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { status: "ACTIVE", properties: { some: { propertyId } }, employees: { none: { propertyId, id: employeeId ? { not: employeeId } : undefined } } },
      orderBy: { name: "asc" }, select: { id: true, name: true, email: true },
    }),
  ]);
  return { departments, shifts, users };
}
