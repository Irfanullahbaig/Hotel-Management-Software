"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, clientInfo, destroySession } from "@/server/auth/session";
import { dummyVerify, hashPassword, passwordProblems, verifyPassword } from "@/server/auth/password";
import { PROPERTY_COOKIE, requireAuth } from "@/server/auth/context";
import type { ActionState } from "./types";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const IP_LIMIT_PER_15M = 30;

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Enter your email and password." };
  const { email, password } = parsed.data;
  const { ip } = await clientInfo();
  const since = new Date(Date.now() - 15 * 60_000);
  const ipFailures = await prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } });
  if (ipFailures >= IP_LIMIT_PER_15M) return { ok: false, error: "Too many sign-in attempts from this network. Try again in 15 minutes." };

  const user = await prisma.user.findUnique({ where: { email } });
  const fail = async (message = "Email or password is incorrect.") => {
    await prisma.loginAttempt.create({ data: { email, ip, success: false } });
    return { ok: false, error: message } as const;
  };
  if (!user) {
    await dummyVerify(password);
    return fail();
  }
  if (user.status === "INACTIVE") return fail("This account has been deactivated.");
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail(`Account locked after repeated failed attempts. Try again after ${user.lockedUntil.toISOString().slice(11, 16)} UTC or ask an administrator.`);
  if (!(await verifyPassword(password, user.passwordHash))) {
    const count = user.failedLoginCount + 1;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: count, lockedUntil: count >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    await prisma.auditLog.create({ data: { userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id, summary: `Failed sign-in (${count})`, ip } });
    return fail(count >= MAX_FAILED ? `Too many failed attempts. The account is locked for ${LOCK_MINUTES} minutes.` : undefined);
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await prisma.loginAttempt.create({ data: { email, ip, success: true } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, summary: "Signed in", ip } });
  await createSession(user.id);
  const next = String(fd.get("next") ?? "");
  redirect(user.mustChangePassword ? "/account?first=1" : next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchPropertyAction(fd: FormData) {
  const ctx = await requireAuth();
  const id = String(fd.get("propertyId") ?? "");
  if (ctx.properties.some((p) => p.id === id)) {
    (await cookies()).set(PROPERTY_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  redirect("/dashboard");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAuth();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false, error: "Current password is incorrect." };
  const problem = passwordProblems(next);
  if (problem) return { ok: false, error: problem };
  if (next !== confirm) return { ok: false, error: "New passwords do not match." };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  // Sign out every other session.
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "auth.password_changed", entityType: "User", entityId: user.id, summary: "Changed own password" } });
  return { ok: true, message: "Password changed. Other sessions were signed out." };
}
