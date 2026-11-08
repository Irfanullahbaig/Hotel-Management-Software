"use server";

import { z } from "zod";

import { hashPassword, passwordProblems } from "@/server/auth/password";
import { allPermissionCodes } from "@/server/auth/permissions";
import { audit, BusinessError } from "@/server/services/common";
import { bootstrapProperty } from "@/server/services/setup";
import { formObject, mutate, zs } from "./util";
import type { ActionState } from "./types";

export async function savePropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("settings.edit", async (tx, ctx) => {
    const d = z.object({
      name: zs.req("Hotel name"), address: zs.str, phone: zs.str, email: zs.email, website: zs.str, description: zs.text,
      currency: z.string().trim().length(3, "Use a 3-letter currency code").transform((s) => s.toUpperCase()),
      timeZone: zs.req("Time zone").refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone"),
      checkInTime: z.string().regex(/^\d{2}:\d{2}$/), checkOutTime: z.string().regex(/^\d{2}:\d{2}$/),
      taxRate: z.coerce.number().min(0).max(100), serviceChargeRate: z.coerce.number().min(0).max(100), depositPercent: z.coerce.number().min(0).max(100),
      cancellationPolicy: zs.text, requireInspection: zs.bool, allowCheckoutBalance: zs.bool,
    }).parse(formObject(fd));
    const before = await tx.property.findUniqueOrThrow({ where: { id: ctx.property.id } });
    const after = await tx.property.update({ where: { id: ctx.property.id }, data: { ...d, address: d.address ?? null, phone: d.phone ?? null, email: d.email ?? null, website: d.website ?? null, description: d.description ?? null, cancellationPolicy: d.cancellationPolicy ?? null } });
    await audit(tx, ctx.actor, "settings.property", "Property", ctx.property.id, "Updated hotel settings", { before, after });
    return { ok: true, message: "Settings saved. Tax and service charge changes apply to charges posted from now on." };
  });
}

export async function createPropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("settings.create", async (tx, ctx) => {
    if (!ctx.user.isSuperAdmin) throw new BusinessError("Only a Super Admin can add properties.");
    const d = z.object({ name: zs.req("Name"), code: z.string().trim().min(2).max(6).regex(/^[A-Za-z0-9]+$/, "Letters and digits only").transform((s) => s.toUpperCase()), currency: z.string().length(3).transform((s) => s.toUpperCase()), timeZone: zs.req("Time zone") }).parse(formObject(fd));
    const p = await tx.property.create({ data: { ...d, organizationId: ctx.user.organizationId } });
    await bootstrapProperty(tx, p.id);
    await tx.userProperty.create({ data: { userId: ctx.user.id, propertyId: p.id } });
    await audit(tx, ctx.actor, "property.create", "Property", p.id, `Created property ${p.name}`);
    return { ok: true, message: `${p.name} created with its own chart of accounts. Switch to it from the top bar.` };
  });
}

const userSchema = z.object({
  id: zs.str, name: zs.req("Name"), email: z.string().trim().toLowerCase().email("Enter a valid email"), phone: zs.str, department: zs.str,
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).default("ACTIVE"), password: zs.str,
});

export async function saveUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const isNew = !fd.get("id");
  return mutate(isNew ? "users.create" : "users.edit", async (tx, ctx) => {
    const d = userSchema.parse(formObject(fd));
    const roleIds = fd.getAll("roles").map(String);
    const propertyIds = fd.getAll("properties").map(String);
    const roles = await tx.role.findMany({ where: { id: { in: roleIds }, organizationId: ctx.user.organizationId } });
    if (roles.some((r) => r.key === "super_admin") && !ctx.user.isSuperAdmin) throw new BusinessError("Only a Super Admin can grant the Super Admin role.");
    const props = await tx.property.findMany({ where: { id: { in: propertyIds }, organizationId: ctx.user.organizationId } });
    if (!ctx.user.isSuperAdmin && props.some((p) => !ctx.properties.some((cp) => cp.id === p.id))) throw new BusinessError("You can only grant access to properties you manage.");
    if (props.length === 0) throw new BusinessError("Give the user access to at least one property.");
    if (d.id === ctx.user.id && d.status !== "ACTIVE") throw new BusinessError("You cannot deactivate your own account.");

    let userId = d.id;
    if (isNew) {
      if (!d.password) throw new BusinessError("Set an initial password.");
      const problem = passwordProblems(d.password);
      if (problem) throw new BusinessError(problem);
      if (await tx.user.findUnique({ where: { email: d.email } })) throw new BusinessError("A user with this email already exists.");
      const u = await tx.user.create({ data: { organizationId: ctx.user.organizationId, name: d.name, email: d.email, phone: d.phone, department: d.department, passwordHash: await hashPassword(d.password), mustChangePassword: true, isSuperAdmin: roles.some((r) => r.key === "super_admin") } });
      userId = u.id;
    } else {
      const before = await tx.user.findFirstOrThrow({ where: { id: d.id, organizationId: ctx.user.organizationId } });
      await tx.user.update({ where: { id: before.id }, data: { name: d.name, email: d.email, phone: d.phone ?? null, department: d.department ?? null, status: d.status, isSuperAdmin: roles.some((r) => r.key === "super_admin"), ...(d.status === "ACTIVE" && before.status === "LOCKED" ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
      if (d.status !== "ACTIVE") await tx.session.updateMany({ where: { userId: before.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await tx.userRole.deleteMany({ where: { userId: userId!, propertyId: null } });
    if (roles.length) await tx.userRole.createMany({ data: roles.map((r) => ({ userId: userId!, roleId: r.id })) });
    await tx.userProperty.deleteMany({ where: { userId: userId! } });
    await tx.userProperty.createMany({ data: props.map((p) => ({ userId: userId!, propertyId: p.id })) });
    await audit(tx, ctx.actor, isNew ? "user.create" : "user.update", "User", userId!, `${isNew ? "Created" : "Updated"} user ${d.email}`, { after: { name: d.name, email: d.email, status: d.status, roles: roles.map((r) => r.key), properties: props.map((p) => p.code) } });
    return { ok: true, message: isNew ? "User created. They must change the password at first sign-in." : "User saved.", redirectTo: "/settings/users" };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("users.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("User"), password: z.string().min(1) }).parse(formObject(fd));
    const problem = passwordProblems(d.password);
    if (problem) throw new BusinessError(problem);
    const u = await tx.user.findFirstOrThrow({ where: { id: d.id, organizationId: ctx.user.organizationId } });
    if (u.isSuperAdmin && !ctx.user.isSuperAdmin) throw new BusinessError("Only a Super Admin can reset a Super Admin's password.");
    await tx.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(d.password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, ctx.actor, "user.password_reset", "User", u.id, `Reset password for ${u.email}`);
    return { ok: true, message: "Password reset. All of the user's sessions were signed out." };
  });
}

export async function revokeSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("users.manage_sessions", async (tx, ctx) => {
    const id = zs.req("Session").parse(fd.get("id"));
    const s = await tx.session.findFirstOrThrow({ where: { id, user: { organizationId: ctx.user.organizationId } }, include: { user: true } });
    await tx.session.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, ctx.actor, "session.revoke", "User", s.userId, `Signed out a session of ${s.user.email}`);
    return { ok: true, message: "Session signed out." };
  });
}

export async function saveRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("roles.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, name: zs.req("Role name"), description: zs.str }).parse(formObject(fd));
    const codes = fd.getAll("perm").map(String);
    const valid = new Set(allPermissionCodes().map((p) => p.code));
    if (codes.some((c) => !valid.has(c))) throw new BusinessError("Unknown permission.");
    let role;
    if (d.id) {
      role = await tx.role.findFirstOrThrow({ where: { id: d.id, organizationId: ctx.user.organizationId } });
      if (role.key === "super_admin") throw new BusinessError("The Super Admin role always has every permission.");
      await tx.role.update({ where: { id: role.id }, data: { name: d.name, description: d.description ?? null } });
    } else {
      const key = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Date.now().toString(36);
      role = await tx.role.create({ data: { organizationId: ctx.user.organizationId, key, name: d.name, description: d.description } });
    }
    const before = await tx.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: true } });
    const perms = await tx.permission.findMany({ where: { code: { in: codes } } });
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await audit(tx, ctx.actor, d.id ? "role.update" : "role.create", "Role", role.id, `${d.id ? "Updated" : "Created"} role ${d.name} (${perms.length} permissions)`, { before: before.map((b) => b.permission.code), after: codes });
    return { ok: true, message: "Role saved. Changes apply on each user's next page load.", redirectTo: `/settings/roles/${role.id}` };
  });
}

export async function deleteRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("roles.delete", async (tx, ctx) => {
    const id = zs.req("Role").parse(fd.get("id"));
    const role = await tx.role.findFirstOrThrow({ where: { id, organizationId: ctx.user.organizationId }, include: { _count: { select: { users: true } } } });
    if (role.isSystem) throw new BusinessError("Built-in roles cannot be deleted. Edit their permissions instead.");
    if (role._count.users) throw new BusinessError(`${role._count.users} user(s) still have this role.`);
    await tx.role.delete({ where: { id } });
    await audit(tx, ctx.actor, "role.delete", "Role", id, `Deleted role ${role.name}`);
    return { ok: true, message: "Role deleted.", redirectTo: "/settings/roles" };
  });
}

export async function markNotificationsReadAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return mutate("notifications.view", async (tx, ctx) => {
    await tx.notification.updateMany({ where: { propertyId: ctx.property.id, readAt: null, OR: [{ userId: null }, { userId: ctx.user.id }] }, data: { readAt: new Date() } });
    return { ok: true, message: "All caught up." };
  });
}

