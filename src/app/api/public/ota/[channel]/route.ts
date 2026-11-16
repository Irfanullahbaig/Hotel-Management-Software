import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { businessToday, parseDateOnly } from "@/lib/dates";
import { createReservation } from "@/server/services/reservations";
import { BusinessError } from "@/server/services/common";

const SOURCE = { BOOKING_COM: "BOOKING_COM", EXPEDIA: "EXPEDIA", AGODA: "AGODA", AIRBNB: "AIRBNB" } as const;

const body = z.object({
  hotelCode: z.string().min(1), externalId: z.string().min(1).max(100), roomCode: z.string().min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), adults: z.number().int().min(1).max(10), children: z.number().int().min(0).max(10).default(0),
  guest: z.object({ firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100), email: z.string().email().optional(), phone: z.string().max(40).optional() }),
  specialRequests: z.string().max(2000).optional(),
});

/**
 * Inbound OTA reservation webhook. Disabled (503) unless OTA_WEBHOOK_SECRET is set; requests must send the
 * secret in the `x-hms-signature` header. Re-delivery of the same externalId is ignored (idempotent).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const secret = process.env.OTA_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "OTA webhook is not configured" }, { status: 503 });
  const sig = Buffer.from(req.headers.get("x-hms-signature") ?? "");
  const want = Buffer.from(secret);
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const channel = (await params).channel.toUpperCase() as keyof typeof SOURCE;
  if (!SOURCE[channel]) return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const conn = await prisma.channelConnection.findFirst({ where: { channel, hotelCode: d.hotelCode, isEnabled: true }, include: { mappings: true, property: true } });
  if (!conn) return NextResponse.json({ error: "No enabled connection for that hotel code" }, { status: 404 });
  const map = conn.mappings.find((m) => m.channelRoomCode === d.roomCode);
  if (!map) return NextResponse.json({ error: "Room code is not mapped" }, { status: 422 });
  try {
    const res = await prisma.$transaction(async (tx) => {
      const r = await createReservation(tx, { userId: null, propertyId: conn.propertyId }, {
        source: SOURCE[channel], status: "CONFIRMED", checkIn: parseDateOnly(d.checkIn), checkOut: parseDateOnly(d.checkOut),
        rooms: [{ roomTypeId: map.roomTypeId, adults: d.adults, children: d.children }], guest: d.guest, specialRequests: d.specialRequests ?? null,
        notes: `${channel} booking ${d.externalId}`, idempotencyKey: `ota:${channel}:${d.externalId}`, today: businessToday(conn.property.timeZone),
      });
      await tx.channelSyncLog.create({ data: { connectionId: conn.id, kind: "RESERVATIONS", status: "SUCCESS", message: `Received ${d.externalId} → ${r.reference}` } });
      return r;
    }, { timeout: 20000 });
    return NextResponse.json({ reference: res.reference });
  } catch (e) {
    const msg = e instanceof BusinessError ? e.message : "Could not create the reservation";
    await prisma.channelSyncLog.create({ data: { connectionId: conn.id, kind: "RESERVATIONS", status: "FAILED", message: `${d.externalId}: ${msg}` } });
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
