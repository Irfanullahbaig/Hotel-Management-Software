import Link from "next/link";
import { CalendarRange, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate, parseDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader, Pagination, EmptyState } from "@/components/ui/layout";
import { LinkButton, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Reservations" };
export const dynamic = "force-dynamic";
const PAGE = 25;
const SORTS: Record<string, Prisma.ReservationOrderByWithRelationInput> = {
  checkIn: { checkIn: "asc" }, "-checkIn": { checkIn: "desc" }, created: { createdAt: "asc" }, "-created": { createdAt: "desc" }, total: { grandTotal: "asc" }, "-total": { grandTotal: "desc" },
};

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageAuth("reservations.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const safeDate = (v?: string) => { try { return v ? parseDateOnly(v) : undefined; } catch { return undefined; } };
  const where: Prisma.ReservationWhereInput = {
    propertyId: ctx.property.id,
    status: sp.status ? (sp.status as Prisma.EnumReservationStatusFilter["equals"]) : undefined,
    source: sp.source ? (sp.source as Prisma.EnumBookingSourceFilter["equals"]) : undefined,
    checkIn: { gte: safeDate(sp.from), lte: safeDate(sp.to) },
    ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { guest: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } }, { companyName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.reservation.findMany({ where, include: { guest: true, rooms: { include: { room: true, roomType: true } }, folio: { include: { transactions: { select: { amount: true, type: true } } } } }, orderBy: SORTS[sp.sort ?? "-created"] ?? SORTS["-created"], skip: (page - 1) * PAGE, take: PAGE }),
    prisma.reservation.count({ where }),
  ]);
  const qs = (p: Record<string, string | number | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const sortLink = (key: string, label: string) => {
    const cur = sp.sort ?? "-created";
    const next = cur === key ? `-${key}` : key;
    return <Link href={qs({ sort: next, page: 1 })} className="hover:text-ink">{label}{cur === key ? " ↑" : cur === `-${key}` ? " ↓" : ""}</Link>;
  };

  return (
    <>
      <PageHeader title="Reservations" description="Search, filter and manage every booking."
        actions={<>
          <LinkButton href="/reservations/calendar" variant="secondary"><CalendarRange className="size-4" /> Calendar</LinkButton>
          {ctx.can("reservations.create") && <LinkButton href="/reservations/new"><Plus className="size-4" /> New reservation</LinkButton>}
        </>}
      />
      <Card>
        <form className="flex flex-wrap items-end gap-2 border-b border-border p-3" method="get">
          <Input name="q" defaultValue={q} placeholder="Reference, guest, email, phone, company" className="w-72" aria-label="Search" />
          <Select name="status" defaultValue={sp.status ?? ""} className="w-40" aria-label="Status">
            <option value="">All statuses</option>
            {["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <Select name="source" defaultValue={sp.source ?? ""} className="w-40" aria-label="Source">
            <option value="">All sources</option>
            {["DIRECT", "WALK_IN", "PHONE", "WEBSITE", "TRAVEL_AGENT", "CORPORATE", "BOOKING_COM", "EXPEDIA", "AGODA", "AIRBNB", "OTHER_OTA"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          <label className="flex items-center gap-1 text-xs text-ink-3">Arrival <Input type="date" name="from" defaultValue={sp.from} className="w-36" /></label>
          <label className="flex items-center gap-1 text-xs text-ink-3">to <Input type="date" name="to" defaultValue={sp.to} className="w-36" /></label>
          <Button type="submit" variant="secondary">Search</Button>
          {(q || sp.status || sp.source || sp.from || sp.to) && <Link href="/reservations" className="px-2 text-xs text-ink-3 hover:text-ink">Clear</Link>}
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No reservations found" description={q ? "Try a different search term or clear the filters." : "New bookings will appear here."} action={ctx.can("reservations.create") ? <LinkButton href="/reservations/new">New reservation</LinkButton> : undefined} />
        ) : (
          <Table>
            <THead><tr><TH>Reference</TH><TH>Guest</TH><TH>{sortLink("checkIn", "Stay")}</TH><TH>Rooms</TH><TH>Source</TH><TH>Status</TH><TH className="text-right">{sortLink("total", "Total")}</TH><TH className="text-right">Balance</TH></tr></THead>
            <TBody>
              {rows.map((r) => {
                const txns = r.folio?.transactions ?? [];
                const folioSum = txns.reduce((a, t) => a + Number(t.amount), 0);
                const paid = -txns.filter((t) => t.type === "PAYMENT" || t.type === "REFUND").reduce((a, t) => a + Number(t.amount), 0);
                const balance = r.status === "CHECKED_OUT" ? folioSum : Number(r.grandTotal) - paid;
                return (
                  <TR key={r.id}>
                    <TD><Link href={`/reservations/${r.id}`} className="font-medium text-brand hover:underline">{r.reference}</Link>{r.isDemo && <Badge className="ml-1.5">Demo</Badge>}</TD>
                    <TD><div className="flex items-center gap-1.5">{fullName(r.guest)}{r.guest.isVip && <Badge tone="warn">VIP</Badge>}</div>{r.companyName && <div className="text-xs text-ink-3">{r.companyName}</div>}</TD>
                    <TD className="whitespace-nowrap">{formatDate(r.checkIn)} → {formatDate(r.checkOut)}</TD>
                    <TD className="text-xs text-ink-2">{r.rooms.filter((l) => l.status !== "CANCELLED").map((l) => l.room?.number ?? l.roomType.code).join(", ") || "—"}</TD>
                    <TD className="text-xs text-ink-2">{titleCase(r.source)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.grandTotal, ctx.property.currency)}</TD>
                    <TD className={`text-right tabular-nums ${balance > 0.004 && !["CANCELLED", "NO_SHOW"].includes(r.status) ? "text-warn" : "text-ink-3"}`}>{["CANCELLED", "NO_SHOW"].includes(r.status) ? "—" : formatMoney(balance, ctx.property.currency)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => `/reservations${qs({ page: p })}`} />
      </Card>
    </>
  );
}
