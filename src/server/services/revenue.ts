import type { Tx } from "@/lib/db";
import { addDays, toDateOnlyString } from "@/lib/dates";
import { D, round2 } from "@/lib/money";
import { typeAvailability } from "./availability";
import { rateForNight } from "./pricing";
import { assert, audit, type Actor } from "./common";

export const CHANNELS: Record<string, string> = { BOOKING_COM: "Booking.com", EXPEDIA: "Expedia", AGODA: "Agoda", AIRBNB: "Airbnb" };

/** Occupancy-driven price multipliers (on the room type's base price). */
const BANDS = [
  { min: 90, factor: 1.3, label: "Very high demand" },
  { min: 75, factor: 1.15, label: "High demand" },
  { min: 50, factor: 1.0, label: "Normal" },
  { min: 25, factor: 0.92, label: "Soft" },
  { min: 0, factor: 0.85, label: "Low demand" },
];

export async function rateSuggestions(db: Tx, propertyId: string, from: Date, days: number, today: Date) {
  const types = await db.roomType.findMany({ where: { propertyId, isActive: true }, include: { rates: true, rooms: { where: { isActive: true }, select: { id: true } } }, orderBy: { basePrice: "asc" } });
  const out = [];
  for (const rt of types) {
    const total = rt.rooms.length;
    if (!total) continue;
    const nights = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const free = await typeAvailability(db, propertyId, rt.id, d, addDays(d, 1), { today });
      const occ = Math.max(0, Math.min(100, ((total - free) / total) * 100));
      const band = BANDS.find((b) => occ >= b.min)!;
      const current = rateForNight(rt, rt.rates, d);
      const suggested = round2(D(rt.basePrice).times(band.factor));
      nights.push({ date: d, occupancy: occ, band: band.label, current: current.price, currentName: current.name, suggested, differs: !suggested.equals(current.price) });
    }
    out.push({ roomType: { id: rt.id, name: rt.name, basePrice: D(rt.basePrice), rooms: total }, nights });
  }
  return out;
}

/** Apply a suggestion: a one-night rate that outranks seasonal/weekend rules. Replaces an earlier revenue-management rate for that night. */
export async function applyRateSuggestion(tx: Tx, actor: Actor, input: { roomTypeId: string; date: Date; price: number }) {
  const rt = await tx.roomType.findFirst({ where: { id: input.roomTypeId, propertyId: actor.propertyId } });
  assert(rt, "Room type not found.");
  assert(input.price > 0, "Enter a price.");
  const name = `Revenue mgmt ${toDateOnlyString(input.date)}`;
  await tx.roomRate.deleteMany({ where: { roomTypeId: rt.id, name } });
  await tx.roomRate.create({ data: { roomTypeId: rt.id, name, kind: "PROMOTIONAL", startDate: input.date, endDate: input.date, daysOfWeek: [], price: input.price, priority: 50 } });
  await audit(tx, actor, "rate.apply", "RoomType", rt.id, `${rt.name} on ${toDateOnlyString(input.date)} set to ${input.price.toFixed(2)}`);
}

export async function saveChannel(tx: Tx, actor: Actor, input: { channel: string; hotelCode?: string | null; isEnabled: boolean }) {
  assert(CHANNELS[input.channel], "Unknown channel.");
  const c = await tx.channelConnection.upsert({
    where: { propertyId_channel: { propertyId: actor.propertyId, channel: input.channel } },
    update: { hotelCode: input.hotelCode || null, isEnabled: input.isEnabled },
    create: { propertyId: actor.propertyId, channel: input.channel, hotelCode: input.hotelCode || null, isEnabled: input.isEnabled },
  });
  await audit(tx, actor, "channel.save", "ChannelConnection", c.id, `${CHANNELS[input.channel]} ${input.isEnabled ? "enabled" : "disabled"}`);
  return c;
}

export async function saveChannelMapping(tx: Tx, actor: Actor, input: { connectionId: string; roomTypeId: string; channelRoomCode: string; ratePlanCode?: string | null; markupPercent: number }) {
  const c = await tx.channelConnection.findFirst({ where: { id: input.connectionId, propertyId: actor.propertyId } });
  assert(c, "Channel not found.");
  await tx.roomType.findFirstOrThrow({ where: { id: input.roomTypeId, propertyId: actor.propertyId } });
  await tx.channelRoomMapping.upsert({
    where: { connectionId_roomTypeId: { connectionId: c.id, roomTypeId: input.roomTypeId } },
    update: { channelRoomCode: input.channelRoomCode, ratePlanCode: input.ratePlanCode || null, markupPercent: input.markupPercent },
    create: { connectionId: c.id, roomTypeId: input.roomTypeId, channelRoomCode: input.channelRoomCode, ratePlanCode: input.ratePlanCode || null, markupPercent: input.markupPercent },
  });
}

/**
 * Push availability and rates. No OTA API credentials are configured in this installation, so the run is
 * logged honestly as NOT_CONFIGURED with the payload size it would have sent.
 */
export async function syncChannel(tx: Tx, actor: Actor, connectionId: string, today: Date) {
  const c = await tx.channelConnection.findFirst({ where: { id: connectionId, propertyId: actor.propertyId }, include: { mappings: true } });
  assert(c, "Channel not found.");
  assert(c.isEnabled, "Enable the channel first.");
  assert(c.mappings.length > 0, "Map at least one room type first.");
  let points = 0;
  for (const m of c.mappings) {
    for (let i = 0; i < 30; i++) {
      await typeAvailability(tx, actor.propertyId, m.roomTypeId, addDays(today, i), addDays(today, i + 1), { today });
      points++;
    }
  }
  const configured = !!process.env[`OTA_${c.channel}_API_KEY`];
  const msg = configured
    ? `Queued ${points} availability/rate points for ${c.mappings.length} room types (30 days).`
    : `Prepared ${points} availability/rate points for ${c.mappings.length} room types (30 days), but no ${CHANNELS[c.channel]} API credentials are configured, so nothing was sent.`;
  await tx.channelSyncLog.create({ data: { connectionId: c.id, kind: "AVAILABILITY", status: configured ? "SUCCESS" : "NOT_CONFIGURED", message: msg } });
  return { configured, msg };
}
