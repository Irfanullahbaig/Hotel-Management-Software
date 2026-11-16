import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, ZERO, round2 } from "@/lib/money";
import { diffNights } from "@/lib/dates";
import { postDiscount, folioBalance } from "./folio";
import { assert, audit, nextNumber, notify, pad, type Actor } from "./common";

// ─── Loyalty ───

export const TIERS = [
  { name: "Platinum", min: 5000 },
  { name: "Gold", min: 1500 },
  { name: "Silver", min: 0 },
] as const;
export const tierFor = (lifetime: number) => TIERS.find((t) => lifetime >= t.min)!.name;

export async function enrollLoyalty(tx: Tx, actor: Actor, guestId: string) {
  const g = await tx.guest.findFirst({ where: { id: guestId, propertyId: actor.propertyId }, include: { loyalty: true } });
  assert(g, "Guest not found.");
  assert(!g.loyalty, `${g.firstName} ${g.lastName} is already a member (${g.loyalty?.number}).`);
  const n = await nextNumber(tx, actor.propertyId, "LOY");
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  const a = await tx.loyaltyAccount.create({ data: { guestId: g.id, number: `${p.code}-L${pad(n, 6)}` } });
  await audit(tx, actor, "loyalty.enroll", "Guest", g.id, `Enrolled ${g.firstName} ${g.lastName} in loyalty (${a.number})`);
  return a;
}

async function movePoints(tx: Tx, actor: Actor, accountId: string, points: number, type: "EARN" | "REDEEM" | "ADJUST", note: string, source?: { type: string; id: string }) {
  const a = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert(a.points + points >= 0, `Only ${a.points} points are available.`);
  if (source) {
    const dup = await tx.loyaltyTxn.findFirst({ where: { accountId, sourceType: source.type, sourceId: source.id } });
    if (dup) return dup;
  }
  const t = await tx.loyaltyTxn.create({ data: { accountId, type, points, note, sourceType: source?.type ?? null, sourceId: source?.id ?? null, createdById: actor.userId } });
  await tx.loyaltyAccount.update({ where: { id: accountId }, data: { points: { increment: points }, ...(points > 0 && type === "EARN" ? { lifetimePoints: { increment: points } } : {}) } });
  return t;
}

/** Called at check-out: members earn `loyaltyEarnRate` points per unit of net room & services spend. */
export async function earnStayPoints(tx: Tx, actor: Actor, guestId: string, invoice: { id: string; number: string; subtotal: Prisma.Decimal.Value; discount: Prisma.Decimal.Value }) {
  const acct = await tx.loyaltyAccount.findUnique({ where: { guestId } });
  if (!acct) return null;
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  const spend = D(invoice.subtotal).minus(invoice.discount);
  const points = Math.floor(spend.times(p.loyaltyEarnRate).toNumber());
  if (points <= 0) return null;
  return movePoints(tx, actor, acct.id, points, "EARN", `Stay ${invoice.number}`, { type: "INVOICE", id: invoice.id });
}

/** Redeem points against an in-house guest's folio as a discount. */
export async function redeemPoints(tx: Tx, actor: Actor, input: { reservationId: string; points: number; today: Date }) {
  const res = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId: actor.propertyId }, include: { folio: true, guest: { include: { loyalty: true } } } });
  assert(res?.folio, "Reservation not found.");
  assert(["CHECKED_IN", "CONFIRMED", "PENDING"].includes(res.status), "Points can only be redeemed on an open stay.");
  const acct = res.guest.loyalty;
  assert(acct, "This guest is not a loyalty member.");
  assert(input.points > 0 && Number.isInteger(input.points), "Enter a whole number of points.");
  const p = await tx.property.findUniqueOrThrow({ where: { id: actor.propertyId } });
  const value = round2(D(input.points).times(p.loyaltyPointValue));
  assert(value.greaterThan(0), "That is not enough points to redeem.");
  const due = await folioBalance(tx, res.folio.id);
  const charges = await tx.folioTransaction.aggregate({ where: { folioId: res.folio.id, amount: { gt: 0 } }, _sum: { amount: true } });
  assert(D(charges._sum.amount).greaterThan(0), "Post some charges to the folio before redeeming points.");
  assert(value.lessThanOrEqualTo(due.greaterThan(0) ? due : ZERO), `The redemption (${value.toFixed(2)}) is more than the ${due.toFixed(2)} balance due.`);
  const t = await movePoints(tx, actor, acct.id, -input.points, "REDEEM", `Redeemed on ${res.reference}`);
  await postDiscount(tx, actor, res.folio.id, value, input.today, `LOY-${t.id}`, `Loyalty ${input.points} points`);
  await audit(tx, actor, "loyalty.redeem", "Reservation", res.id, `Redeemed ${input.points} points (${value.toFixed(2)}) on ${res.reference}`);
  return { value };
}

export async function adjustPoints(tx: Tx, actor: Actor, input: { guestId: string; points: number; note: string }) {
  const acct = await tx.loyaltyAccount.findFirst({ where: { guestId: input.guestId, guest: { propertyId: actor.propertyId } } });
  assert(acct, "This guest is not a loyalty member.");
  assert(input.points !== 0, "Enter a non-zero adjustment.");
  await movePoints(tx, actor, acct.id, input.points, "ADJUST", input.note);
  if (input.points > 0) await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { lifetimePoints: { increment: input.points } } });
  await audit(tx, actor, "loyalty.adjust", "Guest", input.guestId, `Adjusted points by ${input.points}: ${input.note}`);
}

// ─── Coupons ───

export async function evaluateCoupon(
  tx: Tx,
  propertyId: string,
  input: { code: string; checkIn: Date; checkOut: Date; roomTotal: Prisma.Decimal.Value },
) {
  const c = await tx.coupon.findFirst({ where: { propertyId, code: { equals: input.code.trim(), mode: "insensitive" } } });
  assert(c && c.isActive, "That promo code is not valid.");
  assert(!c.validFrom || input.checkIn >= c.validFrom, "That promo code is not valid for these dates yet.");
  assert(!c.validTo || input.checkIn <= c.validTo, "That promo code has expired.");
  assert(diffNights(input.checkIn, input.checkOut) >= c.minNights, `That promo code needs a stay of at least ${c.minNights} nights.`);
  assert(c.maxUses == null || c.usedCount < c.maxUses, "That promo code has been fully used.");
  const total = D(input.roomTotal);
  const off = c.percentOff ? round2(total.times(c.percentOff).dividedBy(100)) : round2(D(c.amountOff));
  return { coupon: c, discount: off.greaterThan(total) ? total : off };
}

export async function useCoupon(tx: Tx, couponId: string) {
  await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
}

// ─── Campaigns ───

export const SEGMENTS: Record<string, string> = {
  ALL: "All guests who opted in",
  VIP: "VIP guests",
  RETURNING: "Returning guests (2+ stays)",
  LOYALTY: "Loyalty members",
  CORPORATE: "Corporate guests",
};

export function segmentWhere(propertyId: string, segment: string, channel: string): Prisma.GuestWhereInput {
  const base: Prisma.GuestWhereInput = { propertyId, marketingConsent: true, ...(channel === "EMAIL" ? { email: { not: null } } : { phone: { not: null } }) };
  switch (segment) {
    case "VIP": return { ...base, isVip: true };
    case "LOYALTY": return { ...base, loyalty: { isNot: null } };
    case "CORPORATE": return { ...base, category: "CORPORATE" };
    case "RETURNING": return { ...base, reservations: { some: { status: "CHECKED_OUT" } } };
    default: return base;
  }
}

/** "Send" a campaign: counts opted-in recipients and records the run. No message provider is configured, so delivery is marked as such. */
export async function sendCampaign(tx: Tx, actor: Actor, campaignId: string) {
  const c = await tx.campaign.findFirst({ where: { id: campaignId, propertyId: actor.propertyId } });
  assert(c, "Campaign not found.");
  assert(c.status === "DRAFT", "This campaign was already sent.");
  let recipients = await tx.guest.count({ where: segmentWhere(actor.propertyId, c.segment, c.channel) });
  if (c.segment === "RETURNING") {
    const guests = await tx.guest.findMany({ where: segmentWhere(actor.propertyId, "ALL", c.channel), select: { _count: { select: { reservations: { where: { status: "CHECKED_OUT" } } } } } });
    recipients = guests.filter((g) => g._count.reservations >= 2).length;
  }
  const provider = c.channel === "EMAIL" ? process.env.EMAIL_PROVIDER : process.env.SMS_PROVIDER;
  await tx.campaign.update({ where: { id: c.id }, data: { status: "SENT", recipients, sentAt: new Date(), delivery: provider ? "QUEUED" : "NOT_CONFIGURED" } });
  await audit(tx, actor, "campaign.send", "Campaign", c.id, `Campaign “${c.name}” to ${recipients} recipients`);
  return { recipients, configured: !!provider };
}

// ─── Feedback ───

export async function logFeedback(
  tx: Tx,
  actor: Actor,
  input: { guestId?: string | null; reservationId?: string | null; kind: "FEEDBACK" | "COMPLAINT"; category: string; rating?: number | null; comments: string },
) {
  if (input.guestId) await tx.guest.findFirstOrThrow({ where: { id: input.guestId, propertyId: actor.propertyId } });
  assert(input.rating == null || (input.rating >= 1 && input.rating <= 5), "Rating is 1 to 5.");
  const f = await tx.guestFeedback.create({ data: { propertyId: actor.propertyId, ...input, guestId: input.guestId || null, reservationId: input.reservationId || null, rating: input.rating ?? null, status: input.kind === "COMPLAINT" ? "OPEN" : "RESOLVED", createdById: actor.userId } });
  if (input.kind === "COMPLAINT") await notify(tx, actor.propertyId, { type: "COMPLAINT", title: `Guest complaint: ${input.category.toLowerCase()}`, body: input.comments.slice(0, 140), link: "/sales?tab=feedback" });
  return f;
}

export async function resolveFeedback(tx: Tx, actor: Actor, id: string, resolution: string) {
  const f = await tx.guestFeedback.findFirst({ where: { id, propertyId: actor.propertyId } });
  assert(f && f.status === "OPEN", "This complaint is already resolved.");
  await tx.guestFeedback.update({ where: { id }, data: { status: "RESOLVED", resolution, resolvedById: actor.userId, resolvedAt: new Date() } });
  await audit(tx, actor, "feedback.resolve", "GuestFeedback", id, `Resolved complaint: ${resolution}`);
}
