import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { EmptyState, Forbidden, PageHeader, Pagination } from "@/components/ui/layout";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Guests" };
export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function GuestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageAuth("guests.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const where: Prisma.GuestWhereInput = {
    propertyId: ctx.property.id,
    isVip: sp.segment === "vip" ? true : undefined,
    category: sp.category ? (sp.category as Prisma.EnumGuestCategoryFilter["equals"]) : undefined,
    ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { company: { contains: q, mode: "insensitive" } }] } : {}),
    ...(sp.segment === "returning" ? { reservations: { some: { status: "CHECKED_OUT" } } } : {}),
  };
  const [guests, total] = await Promise.all([
    prisma.guest.findMany({ where, include: { reservations: { where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { checkIn: true, status: true, grandTotal: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.guest.count({ where }),
  ]);
  // Spend comes from settled invoices (actual money), not booking estimates.
  const spend = await prisma.invoice.groupBy({ by: ["folioId"], where: { folio: { reservation: { guestId: { in: guests.map((g) => g.id) } } } }, _sum: { total: true } });
  const folios = await prisma.folio.findMany({ where: { id: { in: spend.map((s) => s.folioId) } }, select: { id: true, reservation: { select: { guestId: true } } } });
  const spendByGuest = new Map<string, number>();
  for (const s of spend) {
    const gid = folios.find((f) => f.id === s.folioId)?.reservation?.guestId;
    if (gid) spendByGuest.set(gid, (spendByGuest.get(gid) ?? 0) + Number(s._sum.total ?? 0));
  }
  const qs = (p: Record<string, string | number>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return (
    <>
      <PageHeader title="Guests" description="Guest profiles, stay history and segments." actions={ctx.can("guests.create") && <LinkButton href="/guests/new"><Plus className="size-4" /> New guest</LinkButton>} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-border p-3" method="get">
          <Input name="q" defaultValue={q} placeholder="Name, email, phone, company" className="w-72" aria-label="Search guests" />
          <Select name="segment" defaultValue={sp.segment ?? ""} className="w-40" aria-label="Segment"><option value="">All guests</option><option value="vip">VIP</option><option value="returning">Returning</option></Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-40" aria-label="Category"><option value="">All categories</option>{["REGULAR", "CORPORATE", "GROUP", "GOVERNMENT", "TRAVEL_AGENT"].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {guests.length === 0 ? <EmptyState title="No guests found" description="Guests are created automatically with reservations, or you can add one." /> : (
          <Table>
            <THead><tr><TH>Guest</TH><TH>Contact</TH><TH>Nationality</TH><TH>Category</TH><TH className="text-right">Stays</TH><TH>Last stay</TH><TH className="text-right">Invoiced</TH></tr></THead>
            <TBody>
              {guests.map((g) => {
                const stays = g.reservations.filter((r) => r.status === "CHECKED_OUT" || r.status === "CHECKED_IN");
                const last = stays.map((r) => r.checkIn).sort((a, b) => b.getTime() - a.getTime())[0];
                return (
                  <TR key={g.id}>
                    <TD><Link href={`/guests/${g.id}`} className="font-medium text-brand hover:underline">{fullName(g)}</Link> {g.isVip && <Badge tone="warn">VIP</Badge>} {stays.length > 1 && <Badge tone="info">Returning</Badge>} {g.isDemo && <Badge>Demo</Badge>}{g.company && <div className="text-xs text-ink-3">{g.company}</div>}</TD>
                    <TD className="text-xs text-ink-2">{g.email}<div>{g.phone}</div></TD>
                    <TD>{g.nationality ?? "—"}</TD>
                    <TD className="text-xs">{titleCase(g.category)}</TD>
                    <TD className="text-right tabular-nums">{stays.length}</TD>
                    <TD>{last ? formatDate(last) : "—"}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(spendByGuest.get(g.id) ?? 0, ctx.property.currency)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => `/guests${qs({ page: p })}`} />
      </Card>
    </>
  );
}
