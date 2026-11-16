"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { businessToday } from "@/lib/dates";
import { bookOnline } from "@/server/services/booking";
import { formObject, toMessage, zs } from "./util";
import type { ActionState } from "./types";

/** Public (unauthenticated) booking request. Creates a PENDING website reservation for the hotel to confirm. */
export async function publicBookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (fd.get("website")) return { ok: true, message: "Thank you." }; // honeypot: bots fill every field
    const d = z.object({
      propertyId: zs.req("Hotel"), roomTypeId: zs.req("Room"), checkIn: zs.date, checkOut: zs.date, adults: zs.int(1, 10), children: zs.int(0, 10), promo: zs.str,
      firstName: zs.req("First name"), lastName: zs.req("Last name"), email: z.string().trim().toLowerCase().email("Enter a valid email"), phone: zs.req("Phone"),
      country: zs.str, specialRequests: zs.text, marketingConsent: zs.bool, idempotencyKey: zs.req("Key"),
    }).parse(formObject(fd));
    const property = await prisma.property.findUnique({ where: { id: d.propertyId } });
    if (!property) return { ok: false, error: "Hotel not found." };
    const res = await prisma.$transaction((tx) => bookOnline(tx, property.id, { ...d, today: businessToday(property.timeZone) }), { timeout: 20000 });
    return { ok: true, message: `Booking request received. Your reference is ${res.reference}. The hotel will confirm by email; payment is taken at the hotel.` };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
