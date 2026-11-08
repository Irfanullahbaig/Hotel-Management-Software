import Link from "next/link";
import { LogIn, LogOut, UserPlus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NightAuditButton } from "@/components/frontdesk/night-audit";

export const metadata = { title: "Front desk" };
export const dynamic = "force-dynamic";

const include = { guest: true, rooms: { include: { room: true, roomType: true } }, folio: { include: { transactions: { select: { amount: true, type: true } } } } } satisfies Prisma.ReservationInclude;

export default async function FrontDeskPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("frontdesk.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "arrivals";
  const pid = ctx.property.id, today = ctx.today;
  const [arrivals, departures, inHouse, unassigned, walkInsToday] = await Promise.all([
    prisma.reservation.findMany({ where: { propertyId: pid, status: { in: ["CONFIRMED", "PENDING"] }, checkIn: { lte: today } }, include, orderBy: { checkIn: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId: pid, status: "CHECKED_IN", checkOut: { lte: today } }, include, orderBy: { checkOut: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId: pid, status: "CHECKED_IN" }, include, orderBy: { checkOut: "asc" } }),
    prisma.reservation.findMany({ where: { propertyId: pid, status: { in: ["CONFIRMED", "PENDING"] }, checkIn: { lte: addDays(today, 7) }, rooms: { some: { roomId: null, status: "RESERVED" } } }, include, orderBy: { checkIn: "asc" } }),
    prisma.reservation.count({ where: { propertyId: pid, source: "WALK_IN", createdAt: { gte: today } } }),
  ]);
  const [expectedArrivals, expectedDepartures, departedToday, requests] = await Promise.all([
    prisma.reservation.count({ where: { propertyId: pid, checkIn: addDays(today, 1), status: { in: ["CONFIRMED", "PENDING"] } } }),
    prisma.reservation.count({ where: { propertyId: pid, checkOut: addDays(today, 1), status: "CHECKED_IN" } }),
    prisma.reservation.count({ where: { propertyId: pid, checkOut: today, status: "CHECKED_OUT" } }),
    prisma.reservation.findMany({ where: { propertyId: pid, status: { in: ["CHECKED_IN", "CONFIRMED"] }, specialRequests: { not: null }, checkIn: { lte: addDays(today, 1) } }, include, take: 50 }),
  ]);
  const rows = { arrivals, departures, inhouse: inHouse, unassigned, requests }[tab] ?? arrivals;
  const money = (v: number) => formatMoney(v, ctx.property.currency);
  const balanceOf = (r: (typeof arrivals)[number]) => {
    const t = r.folio?.transactions ?? [];
    const paid = -t.filter((x) => x.type === "PAYMENT" || x.type === "REFUND").reduce((a, x) => a + Number(x.amount), 0);
    return Number(r.grandTotal) - paid;
  };

  return (
    <>
      <PageHeader title="Front desk" description={`Business date ${formatDate(today)}`}
        actions={<>
          {ctx.can("frontdesk.night_audit") && <NightAuditButton />}
          {ctx.can("frontdesk.checkin") && ctx.can("reservations.create") && <LinkButton href="/frontdesk/walkin"><UserPlus className="size-4" /> Walk-in</LinkButton>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Arrivals pending" value={arrivals.length} tone={arrivals.some((a) => a.checkIn < today) ? "warn" : undefined} hint={arrivals.some((a) => a.checkIn < today) ? "includes late arrivals" : "today"} />
        <Stat label="Departures pending" value={departures.length} tone={departures.some((a) => a.checkOut < today) ? "danger" : undefined} />
        <Stat label="Departed today" value={departedToday} />
        <Stat label="In house" value={inHouse.length} hint={`${inHouse.reduce((a, r) => a + r.adults + r.children, 0)} guests`} />
        <Stat label="Expected tomorrow" value={expectedArrivals} hint="arrivals" />
        <Stat label="Leaving tomorrow" value={expectedDepartures} />
        <Stat label="Walk-ins today" value={walkInsToday} />
        <Stat label="Unassigned (7 days)" value={unassigned.length} tone={unassigned.length ? "warn" : undefined} />
      </div>
      <Tabs active={tab} items={[
        { key: "arrivals", label: "Arrivals", href: "/frontdesk?tab=arrivals", count: arrivals.length },
        { key: "departures", label: "Departures", href: "/frontdesk?tab=departures", count: departures.length },
        { key: "inhouse", label: "In house", href: "/frontdesk?tab=inhouse", count: inHouse.length },
        { key: "unassigned", label: "Unassigned rooms", href: "/frontdesk?tab=unassigned", count: unassigned.length },
        { key: "requests", label: "Guest requests", href: "/frontdesk?tab=requests", count: requests.length },
      ]} />
      <Card>
        {rows.length === 0 ? <EmptyState title={tab === "arrivals" ? "No arrivals waiting" : tab === "departures" ? "No departures waiting" : "Nothing here"} /> : (
          <Table>
            <THead><tr><TH>Guest</TH><TH>Reference</TH><TH>Stay</TH><TH>Rooms</TH>{tab === "requests" ? <TH>Request</TH> : <TH>Status</TH>}<TH className="text-right">Balance</TH><TH /></tr></THead>
            <TBody>
              {rows.map((r) => {
                const bal = balanceOf(r);
                return (
                  <TR key={r.id}>
                    <TD><Link href={`/guests/${r.guestId}`} className="font-medium hover:underline">{fullName(r.guest)}</Link> {r.guest.isVip && <Badge tone="warn">VIP</Badge>}</TD>
                    <TD><Link href={`/reservations/${r.id}`} className="text-brand hover:underline">{r.reference}</Link><div className="text-[11px] text-ink-3">{titleCase(r.source)}</div></TD>
                    <TD className="whitespace-nowrap">{formatDate(r.checkIn)} → {formatDate(r.checkOut)}{r.status !== "CHECKED_IN" && r.checkIn < today && <Badge tone="warn" className="ml-1">Late</Badge>}{r.status === "CHECKED_IN" && r.checkOut < today && <Badge tone="danger" className="ml-1">Overdue</Badge>}</TD>
                    <TD className="text-xs">{r.rooms.filter((l) => l.status !== "CANCELLED").map((l) => l.room ? l.room.number : <span key={l.id} className="text-warn">{l.roomType.code}?</span>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), [])}</TD>
                    {tab === "requests" ? <TD className="max-w-xs text-xs">{r.specialRequests}</TD> : <TD><StatusBadge status={r.status} /></TD>}
                    <TD className={`text-right tabular-nums ${bal > 0.004 ? "text-warn" : "text-ink-3"}`}>{money(bal)}</TD>
                    <TD className="text-right">
                      {(r.status === "CONFIRMED" || r.status === "PENDING") && r.checkIn <= today && ctx.can("frontdesk.checkin") && <LinkButton href={`/frontdesk/checkin/${r.id}`} size="sm"><LogIn className="size-3.5" /> Check in</LinkButton>}
                      {r.status === "CHECKED_IN" && ctx.can("frontdesk.checkout") && <LinkButton href={`/frontdesk/checkout/${r.id}`} size="sm" variant={r.checkOut <= today ? "primary" : "secondary"}><LogOut className="size-3.5" /> Check out</LinkButton>}
                      {tab === "unassigned" && <LinkButton href={`/reservations/${r.id}`} size="sm" variant="secondary">Assign</LinkButton>}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
