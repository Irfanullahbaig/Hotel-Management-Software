import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "./session";

export const PROPERTY_COOKIE = "hms_property";

export class AuthError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

export type AuthContext = Awaited<ReturnType<typeof loadContext>> & {};

const loadContext = cache(async () => {
  const session = await readSession();
  if (!session) return null;
  const user = session.user;

  const properties = user.isSuperAdmin
    ? await prisma.property.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: { name: "asc" } })
    : (
        await prisma.userProperty.findMany({
          where: { userId: user.id, property: { isActive: true } },
          include: { property: true },
          orderBy: { property: { name: "asc" } },
        })
      ).map((up) => up.property);

  const wanted = (await cookies()).get(PROPERTY_COOKIE)?.value;
  const property = properties.find((p) => p.id === wanted) ?? properties[0] ?? null;

  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id, OR: [{ propertyId: null }, ...(property ? [{ propertyId: property.id }] : [])] },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const permissions = new Set<string>();
  for (const ur of userRoles) for (const rp of ur.role.permissions) permissions.add(rp.permission.code);

  return {
    sessionId: session.id,
    user: { id: user.id, name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin, organizationId: user.organizationId },
    roles: userRoles.map((ur) => ur.role.name),
    permissions,
    properties: properties.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    property,
  };
});

export function can(ctx: { user: { isSuperAdmin: boolean }; permissions: Set<string> } | null, code: string) {
  if (!ctx) return false;
  return ctx.user.isSuperAdmin || ctx.permissions.has(code);
}

export async function getAuth() {
  return loadContext();
}

/** For pages: redirects to login when signed out. */
export async function requireAuth() {
  const ctx = await loadContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For pages and actions that operate on the active property. */
export async function requireProperty(permission?: string) {
  const ctx = await requireAuth();
  if (!ctx.property) throw new AuthError("Your account is not assigned to any property.");
  if (permission && !can(ctx, permission)) throw new AuthError();
  return { ...ctx, property: ctx.property };
}

export async function requirePermission(permission: string) {
  const ctx = await requireAuth();
  if (!can(ctx, permission)) throw new AuthError();
  return ctx;
}
