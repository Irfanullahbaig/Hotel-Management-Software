import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, formatDate, formatDateTime, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { D, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { SEGMENTS, tierFor } from "@/server/services/crm";
import { CHANNELS, rateSuggestions } from "@/server/services/revenue";
import {
  adjustPointsAction, applyRateAction, channelMappingAction, competitorRateAction, enrollLoyaltyAction, logFeedbackAction, loyaltySettingsAction,
  redeemPointsAction, resolveFeedbackAction, saveCampaignAction, saveChannelAction, saveCouponAction, sendCampaignAction, syncChannelAction,
} from "@/server/actions/sales";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, InlineForm, PostButton, type FieldSpec, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Sales & Marketing" };
export const dynamic = "force-dynamic";

const FB_CATS: Opt[] = ["ROOM", "SERVICE", "FOOD", "CLEANLINESS", "STAFF", "NOISE", "BILLING", "OTHER"].map((c) => [c, c[0] + c.slice(1).toLowerCase()]);

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string }> }) {
  const ctx = await pageAuth("sales.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const tab = sp.tab ?? "loyalty";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const canCreate = ctx.can("sales.create");
  const canEdit = ctx.can("sales.edit");
  const [members, memberCount, coupons, openComplaints, avgRating] = await Promise.all([
    tab === "loyalty" ? prisma.loyaltyAccount.findMany({ where: { guest: { propertyId: pid } }, include: { guest: true, txns: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { lifetimePoints: "desc" }, take: 200 }) : [],
    prisma.loyaltyAccount.count({ where: { guest: { propertyId: pid } } }),
    tab === "coupons" ? prisma.coupon.findMany({ where: { propertyId: pid }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }) : [],
    prisma.guestFeedback.count({ where: { propertyId: pid, kind: "COMPLAINT", status: "OPEN" } }),
    prisma.guestFeedback.aggregate({ where: { propertyId: pid, rating: { not: null }, createdAt: { gte: addDays(ctx.today, -90) } }, _avg: { rating: true }, _count: { rating: true } }),
  ]);
  const optedIn = await prisma.guest.count({ where: { propertyId: pid, marketingConsent: true } });
  const activeCoupons = await prisma.coupon.count({ where: { propertyId: pid, isActive: true } });

  return (
    <>
      <PageHeader title="Sales & marketing" description="Loyalty, promotions, campaigns, guest feedback, pricing and online channels." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Loyalty members" value={memberCount} />
        <Stat label="Opted in to marketing" value={optedIn} />
        <Stat label="Active promo codes" value={activeCoupons} />
        <Stat label="Open complaints" value={openComplaints} tone={openComplaints ? "danger" : "ok"} />
        <Stat label="Avg rating (90 days)" value={avgRating._avg.rating ? `${avgRating._avg.rating.toFixed(1)} / 5` : "—"} hint={`${avgRating._count.rating} ratings`} />
      </div>
      <Tabs active={tab} items={[
        { key: "loyalty", label: "Loyalty", href: "/sales?tab=loyalty" },
        { key: "coupons", label: "Promo codes", href: "/sales?tab=coupons" },
        { key: "campaigns", label: "Campaigns", href: "/sales?tab=campaigns" },
        { key: "feedback", label: "Feedback", href: "/sales?tab=feedback", count: openComplaints },
        { key: "revenue", label: "Revenue management", href: "/sales?tab=revenue" },
        { key: "channels", label: "OTA channels", href: "/sales?tab=channels" },
      ]} />

      {tab === "loyalty" && <Loyalty pid={pid} members={members} canEdit={canEdit} canRedeem={ctx.can("frontdesk.payment")} canEnroll={ctx.can("guests.edit")} property={ctx.property} />}

      {tab === "coupons" && (
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm text-ink-2">Codes are entered by guests on the online booking page, or applied as a reservation discount by reception.</p>
            {canCreate && <FormDialog action={saveCouponAction} title="New promo code" trigger="New code" wide fields={couponFields()} />}
          </div>
          {coupons.length === 0 ? <EmptyState title="No promo codes" /> : (
            <Table>
              <THead><tr><TH>Code</TH><TH>Offer</TH><TH>Valid</TH><TH>Min nights</TH><TH className="text-right">Used</TH><TH>Status</TH><TH /></tr></THead>
              <TBody>
                {coupons.map((c) => (
                  <TR key={c.id}>
                    <TD><span className="font-mono font-semibold">{c.code}</span>{c.description && <div className="text-[11px] text-ink-3">{c.description}</div>}</TD>
                    <TD className="text-sm">{c.percentOff ? `${D(c.percentOff).toString()}% off rooms` : `${money(c.amountOff)} off`}</TD>
                    <TD className="text-xs">{c.validFrom ? formatDate(c.validFrom) : "Any time"} → {c.validTo ? formatDate(c.validTo) : "no end"}</TD>
                    <TD className="text-sm">{c.minNights}</TD>
                    <TD className="text-right tabular-nums">{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</TD>
                    <TD><StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} /></TD>
                    <TD className="text-right">{canEdit && <FormDialog action={saveCouponAction} title={`Edit ${c.code}`} trigger="Edit" triggerVariant="ghost" wide fields={couponFields(c)} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "campaigns" && <Campaigns pid={pid} canCreate={canCreate} canSend={ctx.can("sales.approve")} />}
      {tab === "feedback" && <Feedback pid={pid} tz={ctx.property.timeZone} canEdit={canEdit} canLog={ctx.can("guests.view")} />}
      {tab === "revenue" && <Revenue pid={pid} today={ctx.today} from={sp.from} money={money} canApply={canEdit && ctx.can("rooms.edit")} canCreate={canCreate} />}
      {tab === "channels" && <Channels pid={pid} canEdit={canEdit} tz={ctx.property.timeZone} />}
    </>
  );
}

function couponFields(c?: { id: string; code: string; description: string | null; percentOff: unknown; amountOff: unknown; validFrom: Date | null; validTo: Date | null; minNights: number; maxUses: number | null; isActive: boolean }): FieldSpec[] {
  return [
    ...(c ? [{ name: "id", label: "", type: "hidden" as const, defaultValue: c.id }] : []),
    { name: "code", label: "Code", required: true, defaultValue: c?.code, placeholder: "SUMMER25" },
    { name: "description", label: "Description", defaultValue: c?.description },
    { name: "kind", label: "Discount type", type: "select", options: [["PERCENT", "Percent off rooms"], ["AMOUNT", "Fixed amount off"]], required: true, defaultValue: c?.amountOff ? "AMOUNT" : "PERCENT" },
    { name: "value", label: "Value", type: "number", required: true, defaultValue: c ? String(c.percentOff ?? c.amountOff) : 10 },
    { name: "validFrom", label: "Valid for arrivals from", type: "date", defaultValue: c?.validFrom ? toDateOnlyString(c.validFrom) : "" },
    { name: "validTo", label: "Until", type: "date", defaultValue: c?.validTo ? toDateOnlyString(c.validTo) : "" },
    { name: "minNights", label: "Minimum nights", type: "number", step: "1", min: 1, required: true, defaultValue: c?.minNights ?? 1 },
    { name: "maxUses", label: "Max uses", type: "number", step: "1", defaultValue: c?.maxUses ?? "", hint: "Blank = unlimited" },
    { name: "isActive", label: "Active", type: c ? "checkbox" : "hidden", defaultValue: c ? c.isActive : "on" },
  ];
}

async function Loyalty({ pid, members, canEdit, canRedeem, canEnroll, property }: {
  pid: string; members: Awaited<ReturnType<typeof prisma.loyaltyAccount.findMany<{ include: { guest: true; txns: true } }>>>; canEdit: boolean; canRedeem: boolean; canEnroll: boolean;
  property: { loyaltyEarnRate: unknown; loyaltyPointValue: unknown; currency: string };
}) {
  const [nonMembers, openStays] = await Promise.all([
    canEnroll ? prisma.guest.findMany({ where: { propertyId: pid, loyalty: null }, select: { id: true, firstName: true, lastName: true, email: true }, orderBy: { lastName: "asc" }, take: 500 }) : [],
    canRedeem ? prisma.reservation.findMany({ where: { propertyId: pid, status: { in: ["CHECKED_IN"] }, guest: { loyalty: { points: { gt: 0 } } } }, include: { guest: { include: { loyalty: true } } } }) : [],
  ]);
  const value = D(property.loyaltyPointValue as string);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm text-ink-2">Members earn <strong>{String(property.loyaltyEarnRate)}</strong> point(s) per unit spent on stays (net of discounts), credited at check-out. Each point is worth <strong>{formatMoney(value, property.currency)}</strong> when redeemed. Tiers: Silver, Gold (1,500 lifetime), Platinum (5,000).</p>
          <div className="flex gap-2">
            {canEnroll && nonMembers.length > 0 && <FormDialog action={enrollLoyaltyAction} title="Enroll a guest" trigger="Enroll guest" fields={[{ name: "guestId", label: "Guest", type: "select", options: nonMembers.map((g) => [g.id, `${g.lastName}, ${g.firstName}${g.email ? ` · ${g.email}` : ""}`]), required: true, span: 4, empty: "Choose…" }]} />}
            {canRedeem && openStays.length > 0 && (
              <FormDialog action={redeemPointsAction} title="Redeem points on a stay" trigger="Redeem points" triggerVariant="secondary" description="Applied as a discount on the guest's folio."
                fields={[{ name: "reservationId", label: "In-house member", type: "select", options: openStays.map((r) => [r.id, `${r.guest.firstName} ${r.guest.lastName} · ${r.reference} · ${r.guest.loyalty?.points} pts`]), required: true, span: 4 }, { name: "points", label: "Points", type: "number", step: "1", min: 1, required: true, span: 4 }]} />
            )}
            {canEdit && (
              <FormDialog action={loyaltySettingsAction} title="Loyalty settings" trigger="Settings" triggerVariant="ghost"
                fields={[{ name: "loyaltyEarnRate", label: "Points per unit spent", type: "number", step: "0.001", required: true, defaultValue: String(property.loyaltyEarnRate) }, { name: "loyaltyPointValue", label: "Value of one point", type: "number", step: "0.0001", required: true, defaultValue: String(property.loyaltyPointValue) }]} />
            )}
          </div>
        </div>
        {members.length === 0 ? <EmptyState title="No members yet" /> : (
          <Table>
            <THead><tr><TH>Member</TH><TH>Number</TH><TH>Tier</TH><TH className="text-right">Points</TH><TH className="text-right">Worth</TH><TH className="text-right">Lifetime</TH><TH>Last activity</TH><TH /></tr></THead>
            <TBody>
              {members.map((m) => {
                const tier = tierFor(m.lifetimePoints);
                return (
                  <TR key={m.id}>
                    <TD><Link href={`/guests/${m.guestId}`} className="font-medium hover:underline">{m.guest.firstName} {m.guest.lastName}</Link></TD>
                    <TD className="font-mono text-xs">{m.number}</TD>
                    <TD><Badge tone={tier === "Platinum" ? "violet" : tier === "Gold" ? "warn" : "neutral"}>{tier}</Badge></TD>
                    <TD className="text-right font-medium tabular-nums">{m.points.toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(value.times(m.points), property.currency)}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{m.lifetimePoints.toLocaleString()}</TD>
                    <TD className="text-xs">{m.txns[0] ? `${m.txns[0].type.toLowerCase()} ${m.txns[0].points > 0 ? "+" : ""}${m.txns[0].points} · ${formatDate(m.txns[0].createdAt)}` : "—"}</TD>
                    <TD className="text-right">
                      {canEdit && <FormDialog action={adjustPointsAction} title={`Adjust ${m.guest.firstName}'s points`} trigger="Adjust" triggerVariant="ghost" fields={[{ name: "guestId", label: "", type: "hidden", defaultValue: m.guestId }, { name: "points", label: "Points (+/−)", type: "number", step: "1", min: -1000000, required: true }, { name: "note", label: "Reason", required: true }]} />}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function Campaigns({ pid, canCreate, canSend }: { pid: string; canCreate: boolean; canSend: boolean }) {
  const campaigns = await prisma.campaign.findMany({ where: { propertyId: pid }, orderBy: { createdAt: "desc" } });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="max-w-3xl text-sm text-ink-2">Campaigns only go to guests who gave marketing consent. No email or SMS provider is connected in this installation, so sending records the audience but does not deliver messages.</p>
        {canCreate && (
          <FormDialog action={saveCampaignAction} title="New campaign" trigger="New campaign" wide
            fields={[
              { name: "name", label: "Name", required: true, span: 4 },
              { name: "channel", label: "Channel", type: "select", options: [["EMAIL", "Email"], ["SMS", "SMS"], ["WHATSAPP", "WhatsApp"]], required: true, defaultValue: "EMAIL" },
              { name: "segment", label: "Audience", type: "select", options: Object.entries(SEGMENTS), required: true, defaultValue: "ALL" },
              { name: "subject", label: "Subject (email)", span: 3 },
              { name: "couponCode", label: "Promo code", span: 1 },
              { name: "body", label: "Message", type: "textarea", required: true },
            ]} />
        )}
      </div>
      {campaigns.length === 0 ? <EmptyState title="No campaigns" /> : (
        <Table>
          <THead><tr><TH>Campaign</TH><TH>Channel</TH><TH>Audience</TH><TH>Status</TH><TH className="text-right">Recipients</TH><TH>Delivery</TH><TH /></tr></THead>
          <TBody>
            {campaigns.map((c) => (
              <TR key={c.id}>
                <TD><div className="font-medium">{c.name}</div><div className="max-w-md truncate text-[11px] text-ink-3">{c.subject ? `${c.subject} — ` : ""}{c.body}</div></TD>
                <TD className="text-xs">{c.channel.toLowerCase()}</TD>
                <TD className="text-xs">{SEGMENTS[c.segment]}</TD>
                <TD><StatusBadge status={c.status} /></TD>
                <TD className="text-right tabular-nums">{c.status === "SENT" ? c.recipients : "—"}</TD>
                <TD>{c.delivery ? <StatusBadge status={c.delivery} /> : "—"}</TD>
                <TD className="text-right">{c.status === "DRAFT" && canSend && <PostButton action={sendCampaignAction} fields={{ id: c.id }} label="Send" variant="primary" confirm="Send this campaign to all matching opted-in guests?" />}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

async function Feedback({ pid, tz, canEdit, canLog }: { pid: string; tz: string; canEdit: boolean; canLog: boolean }) {
  const [rows, guests] = await Promise.all([
    prisma.guestFeedback.findMany({ where: { propertyId: pid }, include: { guest: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 }),
    prisma.guest.findMany({ where: { propertyId: pid }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" }, take: 500 }),
  ]);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm text-ink-2">Complaints notify managers and stay open until resolved.</p>
        {canLog && (
          <FormDialog action={logFeedbackAction} title="Log feedback or a complaint" trigger="Log feedback" wide
            fields={[
              { name: "kind", label: "Type", type: "select", options: [["FEEDBACK", "Feedback"], ["COMPLAINT", "Complaint"]], required: true, defaultValue: "FEEDBACK" },
              { name: "category", label: "About", type: "select", options: FB_CATS, required: true, defaultValue: "SERVICE" },
              { name: "guestId", label: "Guest", type: "select", options: guests.map((g) => [g.id, `${g.lastName}, ${g.firstName}`]), empty: "Anonymous" },
              { name: "rating", label: "Rating", type: "select", options: [["5", "★★★★★ 5"], ["4", "★★★★ 4"], ["3", "★★★ 3"], ["2", "★★ 2"], ["1", "★ 1"]], empty: "No rating" },
              { name: "comments", label: "Comments", type: "textarea", required: true },
            ]} />
        )}
      </div>
      {rows.length === 0 ? <EmptyState title="No feedback yet" /> : (
        <Table>
          <THead><tr><TH>When</TH><TH>Guest</TH><TH>Type</TH><TH>Rating</TH><TH>Comments</TH><TH>Status</TH><TH /></tr></THead>
          <TBody>
            {rows.map((f) => (
              <TR key={f.id}>
                <TD className="text-xs whitespace-nowrap">{formatDateTime(f.createdAt, tz)}</TD>
                <TD className="text-sm">{f.guest ? <Link href={`/guests/${f.guest.id}`} className="hover:underline">{f.guest.firstName} {f.guest.lastName}</Link> : "Anonymous"}</TD>
                <TD><StatusBadge status={f.kind} /><div className="mt-0.5 text-[11px] text-ink-3">{f.category.toLowerCase()}</div></TD>
                <TD className="text-sm text-warn">{f.rating ? "★".repeat(f.rating) : "—"}</TD>
                <TD className="max-w-md text-sm">{f.comments}{f.resolution && <div className="mt-1 text-xs text-ok">✓ {f.resolution}</div>}</TD>
                <TD><StatusBadge status={f.status} /></TD>
                <TD className="text-right">{f.status === "OPEN" && canEdit && <FormDialog action={resolveFeedbackAction} title="Resolve complaint" trigger="Resolve" triggerVariant="secondary" fields={[{ name: "id", label: "", type: "hidden", defaultValue: f.id }, { name: "resolution", label: "What was done", type: "textarea", required: true }]} />}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

async function Revenue({ pid, today, from: fromStr, money, canApply, canCreate }: { pid: string; today: Date; from?: string; money: (v: unknown) => string; canApply: boolean; canCreate: boolean }) {
  let from = today;
  try { if (fromStr) from = parseDateOnly(fromStr); } catch { /* today */ }
  if (from < today) from = today;
  const days = 14;
  const [suggestions, comp] = await Promise.all([
    prisma.$transaction((tx) => rateSuggestions(tx, pid, from, days, today), { timeout: 20000 }),
    prisma.competitorRate.findMany({ where: { propertyId: pid, date: { gte: from, lte: addDays(from, days) } }, orderBy: [{ date: "asc" }, { competitor: "asc" }] }),
  ]);
  return (
    <div className="space-y-4">
      <form method="get" className="flex items-end gap-2">
        <input type="hidden" name="tab" value="revenue" />
        <label className="text-xs text-ink-3">Starting<Input type="date" name="from" defaultValue={toDateOnlyString(from)} className="w-40" /></label>
        <Button type="submit" variant="secondary" size="sm">Show</Button>
        <LinkButton href={`/sales?tab=revenue&from=${toDateOnlyString(addDays(from, days))}`} variant="ghost" size="sm">Next {days} days →</LinkButton>
      </form>
      <Card>
        <CardHeader title="Rate suggestions" description="Based on how full each room type is on each night: high demand raises the price above the base rate, soft demand lowers it. Applying a suggestion creates a one-night rate that overrides other rules." />
        {suggestions.length === 0 ? <EmptyState title="No room types" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/50"><tr><th className="px-3 py-2 text-left font-medium text-ink-3">Room type</th>{suggestions[0].nights.map((n) => <th key={n.date.getTime()} className="px-2 py-2 text-left font-medium whitespace-nowrap text-ink-3">{formatDate(n.date).slice(0, 6)}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {suggestions.map((s) => (
                  <tr key={s.roomType.id}>
                    <td className="px-3 py-2 whitespace-nowrap"><div className="font-medium">{s.roomType.name}</div><div className="text-ink-3">{s.roomType.rooms} rooms · base {money(s.roomType.basePrice)}</div></td>
                    {s.nights.map((n) => (
                      <td key={n.date.getTime()} className={cn("px-2 py-2 align-top", n.occupancy >= 75 ? "bg-danger-soft/40" : n.occupancy >= 50 ? "bg-warn-soft/40" : "")}>
                        <div className="font-medium tabular-nums">{Math.round(n.occupancy)}%</div>
                        <div className="tabular-nums text-ink-3" title={n.currentName}>{money(n.current)}</div>
                        {n.differs && (
                          <div className="mt-1">
                            <div className={cn("tabular-nums font-medium", n.suggested.greaterThan(n.current) ? "text-ok" : "text-danger")}>→ {money(n.suggested)}</div>
                            {canApply && <PostButton action={applyRateAction} fields={{ roomTypeId: s.roomType.id, date: toDateOnlyString(n.date), price: n.suggested.toFixed(2) }} label="Apply" variant="ghost" />}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Competitor rates" description="Rates you observe at nearby hotels, for comparison." actions={canCreate && (
          <FormDialog action={competitorRateAction} title="Record a competitor rate" trigger="Add rate"
            fields={[{ name: "competitor", label: "Hotel", required: true }, { name: "roomLabel", label: "Room", required: true, placeholder: "Standard double" }, { name: "date", label: "Night", type: "date", required: true, defaultValue: toDateOnlyString(from) }, { name: "price", label: "Price", type: "number", required: true }]} />
        )} />
        {comp.length === 0 ? <EmptyState title="No competitor rates recorded for these dates" /> : (
          <Table>
            <THead><tr><TH>Night</TH><TH>Hotel</TH><TH>Room</TH><TH className="text-right">Price</TH></tr></THead>
            <TBody>{comp.map((c) => <TR key={c.id}><TD className="text-xs">{formatDate(c.date)}</TD><TD>{c.competitor}</TD><TD className="text-sm">{c.roomLabel}</TD><TD className="text-right tabular-nums">{money(c.price)}</TD></TR>)}</TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function Channels({ pid, canEdit, tz }: { pid: string; canEdit: boolean; tz: string }) {
  const [conns, types] = await Promise.all([
    prisma.channelConnection.findMany({ where: { propertyId: pid }, include: { mappings: true, logs: { orderBy: { createdAt: "desc" }, take: 3 } } }),
    prisma.roomType.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="text-sm text-ink-2">
          Connect online travel agencies to publish availability and rates. This installation has no OTA API credentials, so syncs are prepared and logged but nothing is sent.
          Reservations from OTAs are entered under Reservations with the OTA as the source, or arrive through the inbound webhook at <code className="rounded bg-muted px-1">/api/public/ota/&lt;channel&gt;</code> once a shared secret is configured.
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(CHANNELS).map(([key, label]) => {
          const c = conns.find((x) => x.channel === key);
          return (
            <Card key={key}>
              <CardHeader title={label} description={c?.hotelCode ? `Property ID ${c.hotelCode}` : "Not connected"} actions={<Badge tone={c?.isEnabled ? "ok" : "neutral"}>{c?.isEnabled ? "Enabled" : "Off"}</Badge>} />
              <CardBody className="space-y-3">
                {canEdit && <InlineForm action={saveChannelAction} submitLabel="Save" resetOnSuccess={false} fields={[{ name: "channel", label: "", type: "hidden", defaultValue: key }, { name: "hotelCode", label: `${label} property ID`, defaultValue: c?.hotelCode, span: 3 }, { name: "isEnabled", label: "Enabled", type: "checkbox", defaultValue: c?.isEnabled ?? false, span: 1 }]} />}
                {c && (
                  <>
                    <div>
                      <div className="mb-1 text-xs font-medium text-ink-3">Room mapping</div>
                      {c.mappings.length === 0 ? <p className="text-xs text-ink-3">No room types mapped.</p> : (
                        <ul className="text-xs">{c.mappings.map((m) => <li key={m.id}>{typeName.get(m.roomTypeId)} → <span className="font-mono">{m.channelRoomCode}</span>{m.ratePlanCode ? ` / ${m.ratePlanCode}` : ""}{Number(m.markupPercent) ? ` (+${m.markupPercent.toString()}%)` : ""}</li>)}</ul>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <FormDialog action={channelMappingAction} title={`Map a room type to ${label}`} trigger="Map room type" triggerVariant="secondary"
                          fields={[{ name: "connectionId", label: "", type: "hidden", defaultValue: c.id }, { name: "roomTypeId", label: "Room type", type: "select", options: types.map((t) => [t.id, t.name]), required: true, span: 4 }, { name: "channelRoomCode", label: `${label} room code`, required: true }, { name: "ratePlanCode", label: "Rate plan code" }, { name: "markupPercent", label: "Markup %", type: "number", min: -50, defaultValue: 0 }]} />
                        <PostButton action={syncChannelAction} fields={{ id: c.id }} label="Sync availability & rates" />
                      </div>
                    )}
                    {c.logs.length > 0 && (
                      <ul className="space-y-1 border-t border-border pt-2 text-xs">{c.logs.map((l) => <li key={l.id} className="flex gap-2"><StatusBadge status={l.status} /><span className="text-ink-2">{formatDateTime(l.createdAt, tz)} — {l.message}</span></li>)}</ul>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
