import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { D, formatMoney } from "@/lib/money";
import { diffNights, formatDate, formatDateTime } from "@/lib/dates";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AddDocumentDialog } from "@/components/guests/guest-form";

export const dynamic = "force-dynamic";

export default async function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("guests.view");
  if (!ctx) return <Forbidden />;
  const g = await prisma.guest.findFirst({
    where: { id: (await params).id, propertyId: ctx.property.id },
    include: {
      documents: true,
      reservations: { include: { rooms: { include: { roomType: true, room: true } }, folio: { include: { payments: true, invoices: true } } }, orderBy: { checkIn: "desc" } },
    },
  });
  if (!g) notFound();
  const sensitive = ctx.can("guests.view_sensitive");
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const stays = g.reservations.filter((r) => r.status === "CHECKED_OUT" || r.status === "CHECKED_IN");
  const invoiced = g.reservations.flatMap((r) => r.folio?.invoices ?? []).reduce((a, i) => a.plus(i.total), D(0));
  const payments = g.reservations.flatMap((r) => (r.folio?.payments ?? []).map((p) => ({ ...p, reference: r.reference })));
  const typeCount = new Map<string, number>();
  for (const r of stays) for (const l of r.rooms) typeCount.set(l.roomType.name, (typeCount.get(l.roomType.name) ?? 0) + 1);
  const preferredType = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sources = [...new Set(g.reservations.map((r) => titleCase(r.source)))];
  const nights = stays.reduce((a, r) => a + diffNights(r.checkIn, r.checkOut), 0);
  if (sensitive && g.documents.length) {
    await prisma.auditLog.create({ data: { propertyId: ctx.property.id, userId: ctx.user.id, action: "guest.view_documents", entityType: "Guest", entityId: g.id, summary: `Viewed ID documents of ${fullName(g)}` } });
  }
  const mask = (s: string) => (s.length <= 4 ? "••••" : `${"•".repeat(s.length - 4)}${s.slice(-4)}`);

  return (
    <>
      <PageHeader back={{ href: "/guests", label: "Guests" }}
        title={<span className="flex items-center gap-2">{fullName(g)} {g.isVip && <Badge tone="warn">VIP</Badge>}{stays.length > 1 && <Badge tone="info">Returning</Badge>}{g.isDemo && <Badge>Demo data</Badge>}</span>}
        description={[titleCase(g.category), g.company, g.nationality].filter(Boolean).join(" · ")}
        actions={<>
          {ctx.can("guests.edit") && <LinkButton href={`/guests/${g.id}/edit`} variant="secondary"><Pencil className="size-4" /> Edit</LinkButton>}
          {ctx.can("reservations.create") && <LinkButton href="/reservations/new"><Plus className="size-4" /> New booking</LinkButton>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total visits" value={stays.length} />
        <Stat label="Nights stayed" value={nights} />
        <Stat label="Total invoiced" value={money(invoiced)} />
        <Stat label="Average per stay" value={money(stays.length ? invoiced.dividedBy(Math.max(1, g.reservations.filter((r) => r.status === "CHECKED_OUT").length)) : 0)} />
        <Stat label="Last visit" value={stays[0] ? formatDate(stays[0].checkIn) : "—"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Reservations" />
            {g.reservations.length ? (
              <Table>
                <THead><tr><TH>Reference</TH><TH>Stay</TH><TH>Rooms</TH><TH>Source</TH><TH>Status</TH><TH className="text-right">Total</TH></tr></THead>
                <TBody>{g.reservations.map((r) => (
                  <TR key={r.id}>
                    <TD><Link href={`/reservations/${r.id}`} className="text-brand hover:underline">{r.reference}</Link></TD>
                    <TD className="whitespace-nowrap">{formatDate(r.checkIn)} → {formatDate(r.checkOut)}</TD>
                    <TD className="text-xs">{r.rooms.map((l) => l.room?.number ?? l.roomType.code).join(", ")}</TD>
                    <TD className="text-xs">{titleCase(r.source)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-right tabular-nums">{money(r.grandTotal)}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No reservations yet.</CardBody>}
          </Card>
          <Card>
            <CardHeader title="Payment history" />
            {payments.length ? (
              <Table>
                <THead><tr><TH>Receipt</TH><TH>Date</TH><TH>Reservation</TH><TH>Type</TH><TH>Method</TH><TH className="text-right">Amount</TH></tr></THead>
                <TBody>{payments.map((p) => (
                  <TR key={p.id}><TD>{p.receiptNumber}</TD><TD>{formatDateTime(p.receivedAt, ctx.property.timeZone)}</TD><TD>{p.reference}</TD><TD className="text-xs">{titleCase(p.kind)}</TD><TD className="text-xs">{titleCase(p.method)}</TD><TD className={`text-right tabular-nums ${p.kind === "REFUND" ? "text-danger" : ""}`}>{p.kind === "REFUND" ? "−" : ""}{money(p.amount)}</TD></TR>
                ))}</TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No payments yet.</CardBody>}
          </Card>
          <Card>
            <CardHeader title="Complaints & reviews" />
            <CardBody className="text-sm text-ink-3">Feedback and complaint tracking arrives with the guest feedback module (Phase 2/5). Nothing is recorded yet.</CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <DescriptionList className="sm:grid-cols-1" items={[
                ["Email", g.email], ["Phone", g.phone], ["Address", [g.address, g.city, g.country].filter(Boolean).join(", ") || null],
                ["Date of birth", g.dateOfBirth ? formatDate(g.dateOfBirth) : null], ["Emergency contact", [g.emergencyContactName, g.emergencyContactPhone].filter(Boolean).join(" · ") || null],
                ["Preferred room type", preferredType ?? null], ["Booking sources", sources.join(", ") || null], ["Preferences", g.preferences], ["Notes", g.notes],
                ["Marketing consent", g.marketingConsent ? "Yes" : "No"],
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Identification" description={sensitive ? "Viewing is recorded in the audit log" : "Restricted"} actions={sensitive && ctx.can("guests.edit") ? <AddDocumentDialog guestId={g.id} /> : undefined} />
            <CardBody className="space-y-2 text-sm">
              {g.documents.length === 0 && <p className="text-ink-3">No documents on file.</p>}
              {g.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                  <div><div className="font-medium">{titleCase(d.type)}</div><div className="font-mono text-xs">{sensitive ? d.number : mask(d.number)}</div>{sensitive && d.issuingCountry && <div className="text-xs text-ink-3">{d.issuingCountry}{d.expiryDate ? ` · expires ${formatDate(d.expiryDate)}` : ""}</div>}</div>
                  {d.verifiedAt ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
