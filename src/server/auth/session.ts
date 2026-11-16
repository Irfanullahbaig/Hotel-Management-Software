import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "hms_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h sliding
const TOUCH_INTERVAL_MS = 1000 * 60 * 5;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function clientInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

// Built-in demo database (no DATABASE_URL): each server instance has its own
// in-memory data, so a session made on one instance is unknown to the next.
// Demo tokens carry the user's email with a signature, and readSession
// recreates the session row when it is missing. Not used with a real database.
const DEMO_MODE = !process.env.DATABASE_URL;
const demoSecret = () => process.env.SESSION_SECRET ?? "hms-demo-session-secret";
const demoSig = (body: string) => createHmac("sha256", demoSecret()).update(body).digest("base64url");

function demoEmailFromToken(token: string): string | null {
  const [random, email64, sig] = token.split(".");
  if (!random || !email64 || !sig) return null;
  const expected = Buffer.from(demoSig(`${random}.${email64}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Buffer.from(email64, "base64url").toString("utf8");
}

export async function createSession(userId: string) {
  let token = randomBytes(32).toString("hex");
  if (DEMO_MODE) {
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const body = `${token}.${Buffer.from(email).toString("base64url")}`;
    token = `${body}.${demoSig(body)}`;
  }
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), ip, userAgent, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session && DEMO_MODE) {
    const email = demoEmailFromToken(token);
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (user) {
      const { ip, userAgent } = await clientInfo();
      session = await prisma.session.create({
        data: { userId: user.id, tokenHash: hashToken(token), ip, userAgent, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
        include: { user: true },
      });
    }
  }
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== "ACTIVE") return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
}
