"use server";

import { z } from "zod";
import { formObject, mutate, zs, zx } from "./util";
import { audit, BusinessError } from "@/server/services/common";
import { adjustPoints, enrollLoyalty, logFeedback, redeemPoints, resolveFeedback, sendCampaign } from "@/server/services/crm";
import { addEventItem, cancelEvent, completeEvent, confirmEvent, createEvent, eventDeposit, removeEventItem, settleEvent } from "@/server/services/events";
import { applyRateSuggestion, saveChannel, saveChannelMapping, syncChannel } from "@/server/services/revenue";
import type { ActionState } from "./types";

type A = Promise<ActionState>;

// ─── Loyalty ───

export async function enrollLoyaltyAction(_: ActionState, fd: FormData): A {
  return mutate("guests.edit", async (tx, ctx) => {
    const a = await enrollLoyalty(tx, ctx.actor, z.object({ guestId: zs.req("Guest") }).parse(formObject(fd)).guestId);
    return { ok: true, message: `Member ${a.number}.` };
  });
}

export async function redeemPointsAction(_: ActionState, fd: FormData): A {
  return mutate("frontdesk.payment", async (tx, ctx) => {
    const d = z.object({ reservationId: zs.req("Reservation"), points: zs.int(1, 10_000_000) }).parse(formObject(fd));
    const r = await redeemPoints(tx, ctx.actor, { ...d, today: ctx.today });
    return { ok: true, message: `Redeemed for ${r.value.toFixed(2)} off the bill.` };
  });
}

export async function adjustPointsAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const d = z.object({ guestId: zs.req("Guest"), points: z.coerce.number().int().min(-1_000_000).max(1_000_000), note: zs.req("Reason") }).parse(formObject(fd));
    await adjustPoints(tx, ctx.actor, d);
    return { ok: true, message: "Points adjusted." };
  });
}

export async function loyaltySettingsAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const d = z.object({ loyaltyEarnRate: zx.num(0, 1000), loyaltyPointValue: zx.num(0, 1000) }).parse(formObject(fd));
    await tx.property.update({ where: { id: ctx.property.id }, data: d });
    await audit(tx, ctx.actor, "loyalty.settings", "Property", ctx.property.id, `Earn ${d.loyaltyEarnRate}/unit, point value ${d.loyaltyPointValue}`);
    return { ok: true, message: "Loyalty settings saved." };
  });
}

// ─── Coupons & campaigns ───

export async function saveCouponAction(_: ActionState, fd: FormData): A {
  return mutate(fd.get("id") ? "sales.edit" : "sales.create", async (tx, ctx) => {
    const d = z.object({
      id: zs.str, code: zs.req("Code"), description: zs.str, kind: z.enum(["PERCENT", "AMOUNT"]), value: zx.num(0.01, 1_000_000),
      validFrom: zx.optDate, validTo: zx.optDate, minNights: zs.int(1, 365), maxUses: zx.optNum, isActive: zs.bool,
    }).parse(formObject(fd));
    if (d.kind === "PERCENT" && d.value > 100) throw new BusinessError("A percentage cannot exceed 100.");
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw new BusinessError("“Valid to” must be after “Valid from”.");
    const data = {
      code: d.code.toUpperCase().replace(/\s+/g, ""), description: d.description ?? null, percentOff: d.kind === "PERCENT" ? d.value : null, amountOff: d.kind === "AMOUNT" ? d.value : null,
      validFrom: d.validFrom ?? null, validTo: d.validTo ?? null, minNights: d.minNights, maxUses: d.maxUses ? Math.floor(d.maxUses) : null,
    };
    if (d.id) {
      await tx.coupon.findFirstOrThrow({ where: { id: d.id, propertyId: ctx.property.id } });
      await tx.coupon.update({ where: { id: d.id }, data: { ...data, isActive: d.isActive } });
    } else await tx.coupon.create({ data: { ...data, propertyId: ctx.property.id } });
    return { ok: true, message: "Promo code saved." };
  });
}

export async function saveCampaignAction(_: ActionState, fd: FormData): A {
  return mutate("sales.create", async (tx, ctx) => {
    const d = z.object({ name: zs.req("Name"), channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]), segment: z.enum(["ALL", "VIP", "RETURNING", "LOYALTY", "CORPORATE"]), subject: zs.str, body: zs.req("Message").pipe(z.string().max(4000)), couponCode: zs.str }).parse(formObject(fd));
    await tx.campaign.create({ data: { ...d, subject: d.subject ?? null, couponCode: d.couponCode ?? null, propertyId: ctx.property.id, createdById: ctx.user.id } });
    return { ok: true, message: "Campaign saved as a draft." };
  });
}

export async function sendCampaignAction(_: ActionState, fd: FormData): A {
  return mutate("sales.approve", async (tx, ctx) => {
    const r = await sendCampaign(tx, ctx.actor, z.object({ id: zs.req("Campaign") }).parse(formObject(fd)).id);
    return { ok: true, message: r.configured ? `Queued for ${r.recipients} recipients.` : `${r.recipients} opted-in recipients matched. No message provider is configured, so nothing was delivered.` };
  });
}

// ─── Feedback ───

export async function logFeedbackAction(_: ActionState, fd: FormData): A {
  return mutate(["guests.view"], async (tx, ctx) => {
    const d = z.object({ guestId: zs.str, kind: z.enum(["FEEDBACK", "COMPLAINT"]), category: zs.req("Category"), rating: zx.optNum, comments: zs.req("Comments").pipe(z.string().max(4000)) }).parse(formObject(fd));
    await logFeedback(tx, ctx.actor, { ...d, rating: d.rating ?? null });
    return { ok: true, message: d.kind === "COMPLAINT" ? "Complaint logged; managers were notified." : "Feedback saved." };
  });
}

export async function resolveFeedbackAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Complaint"), resolution: zs.req("Resolution") }).parse(formObject(fd));
    await resolveFeedback(tx, ctx.actor, d.id, d.resolution);
    return { ok: true, message: "Resolved." };
  });
}

// ─── Revenue & channels ───

export async function competitorRateAction(_: ActionState, fd: FormData): A {
  return mutate("sales.create", async (tx, ctx) => {
    const d = z.object({ competitor: zs.req("Competitor"), date: zs.date, roomLabel: zs.req("Room"), price: zx.num(0.01) }).parse(formObject(fd));
    await tx.competitorRate.create({ data: { ...d, propertyId: ctx.property.id } });
    return { ok: true, message: "Rate recorded." };
  });
}

export async function applyRateAction(_: ActionState, fd: FormData): A {
  return mutate(["sales.edit", "rooms.edit"], async (tx, ctx) => {
    const d = z.object({ roomTypeId: zs.req("Room type"), date: zs.date, price: zx.num(0.01) }).parse(formObject(fd));
    await applyRateSuggestion(tx, ctx.actor, d);
    return { ok: true, message: "Rate applied." };
  });
}

export async function saveChannelAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const d = z.object({ channel: zs.req("Channel"), hotelCode: zs.str, isEnabled: zs.bool }).parse(formObject(fd));
    await saveChannel(tx, ctx.actor, d);
    return { ok: true, message: "Channel saved." };
  });
}

export async function channelMappingAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const d = z.object({ connectionId: zs.req("Channel"), roomTypeId: zs.req("Room type"), channelRoomCode: zs.req("Channel room code"), ratePlanCode: zs.str, markupPercent: zx.num(-50, 200) }).parse(formObject(fd));
    await saveChannelMapping(tx, ctx.actor, d);
    return { ok: true, message: "Mapping saved." };
  });
}

export async function syncChannelAction(_: ActionState, fd: FormData): A {
  return mutate("sales.edit", async (tx, ctx) => {
    const r = await syncChannel(tx, ctx.actor, z.object({ id: zs.req("Channel") }).parse(formObject(fd)).id, ctx.today);
    return { ok: true, message: r.msg };
  });
}

// ─── Events ───

export async function createEventAction(_: ActionState, fd: FormData): A {
  return mutate("events.create", async (tx, ctx) => {
    const d = z.object({
      venueId: zs.req("Venue"), title: zs.req("Title"), eventType: zs.req("Type"), clientName: zs.req("Client"), company: zs.str, email: zs.email, phone: zs.str,
      date: zs.date, start: zx.clock, end: zx.clock, attendees: zs.int(1, 100000), notes: zs.text, confirmed: zs.bool,
    }).parse(formObject(fd));
    const e = await createEvent(tx, ctx.actor, { ...d, startMinute: d.start, endMinute: d.end, today: ctx.today });
    return { ok: true, message: `${e.number} booked.`, redirectTo: `/events/${e.id}` };
  });
}

export async function eventItemAction(_: ActionState, fd: FormData): A {
  return mutate("events.edit", async (tx, ctx) => {
    const d = z.object({ eventId: zs.req("Event"), description: zs.req("Description"), quantity: zx.num(0.01, 100000), unitPrice: zs.money, revenueAccount: z.enum(["4400", "4300", "4100", "4600"]) }).parse(formObject(fd));
    await addEventItem(tx, ctx.actor, d);
    return { ok: true, message: "Item added." };
  });
}

export async function removeEventItemAction(_: ActionState, fd: FormData): A {
  return mutate("events.edit", async (tx, ctx) => {
    await removeEventItem(tx, ctx.actor, z.object({ id: zs.req("Item") }).parse(formObject(fd)).id);
    return { ok: true, message: "Removed." };
  });
}

export async function eventStatusAction(_: ActionState, fd: FormData): A {
  return mutate("events.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.req("Event"), to: z.enum(["CONFIRMED", "COMPLETED"]) }).parse(formObject(fd));
    if (d.to === "CONFIRMED") await confirmEvent(tx, ctx.actor, d.id);
    else {
      const inv = await completeEvent(tx, ctx.actor, d.id, ctx.today);
      return { ok: true, message: `Completed; invoice ${inv.number} issued.` };
    }
    return { ok: true, message: "Confirmed." };
  });
}

export async function eventPaymentAction(_: ActionState, fd: FormData): A {
  return mutate("events.edit", async (tx, ctx) => {
    const d = z.object({ eventId: zs.req("Event"), kind: z.enum(["DEPOSIT", "SETTLEMENT"]), amount: zx.num(0.01), method: zx.method, reference: zs.str, idempotencyKey: zs.req("Key") }).parse(formObject(fd));
    if (d.kind === "DEPOSIT") await eventDeposit(tx, ctx.actor, { ...d, today: ctx.today });
    else await settleEvent(tx, ctx.actor, { ...d, today: ctx.today });
    return { ok: true, message: "Payment recorded." };
  });
}

export async function cancelEventAction(_: ActionState, fd: FormData): A {
  return mutate("events.delete", async (tx, ctx) => {
    const d = z.object({ eventId: zs.req("Event"), reason: zs.req("Reason"), refundMethod: zx.optMethod, idempotencyKey: zs.req("Key") }).parse(formObject(fd));
    await cancelEvent(tx, ctx.actor, { ...d, refundMethod: d.refundMethod ?? null, today: ctx.today });
    return { ok: true, message: "Event cancelled." };
  });
}

export async function saveVenueAction(_: ActionState, fd: FormData): A {
  return mutate("events.edit", async (tx, ctx) => {
    const d = z.object({ id: zs.str, name: zs.req("Name"), capacity: zs.int(1, 100000), hourlyRate: zs.money, isActive: zs.bool }).parse(formObject(fd));
    const { id, ...data } = d;
    if (id) {
      await tx.eventVenue.findFirstOrThrow({ where: { id, propertyId: ctx.property.id } });
      await tx.eventVenue.update({ where: { id }, data });
    } else await tx.eventVenue.create({ data: { ...data, isActive: true, propertyId: ctx.property.id } });
    return { ok: true, message: "Venue saved." };
  });
}
