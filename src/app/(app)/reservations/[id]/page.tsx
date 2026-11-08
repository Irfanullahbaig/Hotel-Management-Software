import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, LogIn, LogOut } from "lucide-react";
import { prisma } from "@/lib/db";
import { D, formatMoney } from "@/lib/money";
import { diffNights, formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { availableRooms } from "@/server/services/availability";
import { unappliedDeposits } from "@/server/services/folio";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CancelDialog, DatesDialog, EditDetailsDialog, MoveRoomDialog, PaymentDialog } from "@/components/reservations/reservation-actions";

export const dynamic = "force-dynamic";

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("reservations.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const r = await prisma.reservation.findFirst({
    where: { id, propertyId: ctx.property.id },
    include: {
      guest: true,
      rooms: { include: { room: true, roomType: true, nights: { orderBy: { date: "asc" } } }, orderBy: { createdAt: "asc" } },
      folio: { include: { transactions: { orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }] }, payments: { orderBy: { receivedAt: "asc" } }, invoices: true } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!r) notFound();
  const cur = ctx.property.currency;
  const money = (v: unknown) => formatMoney(v as string, cur);
  const open = r.status === "PENDING" || r.status === "CONFIRMED";
  const inHouse = r.status === "CHECKED_IN";
  const txns = r.folio?.transactions ?? [];
  const folioBalance = txns.reduce((a, t) => a.plus(t.amount), D(0));
  const paid = txns.filter((t) => t.type === "PAYMENT" || t.type === "REFUND").reduce((a, t) => a.minus(t.amount), D(0));
  const expectedBalance = r.status === "CHECKED_OUT" ? folioBalance : D(r.grandTotal).minus(paid);
  const held = r.folio ? await unappliedDeposits(prisma, r.folio.id) : D(0);
  const userIds = [...new Set(r.events.map((e) => e.userId).filter(Boolean))] as string[];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const movable = ctx.can("reservations.edit") && (open || inHouse);
  const roomChoices = movable
    ? await Promise.all(r.rooms.filter((l) => l.status === "RESERVED" || l.status === "CHECKED_IN").map(async (l) => ({
        lineId: l.id,
        rooms: (await availableRooms(prisma, ctx.property.id, l.checkIn, l.checkOut, { excludeLineIds: [l.id], today: ctx.today }))
          .filter((x) => l.status === "RESERVED" || x.id === l.roomId || (x.occupancyStatus === "VACANT" && x.housekeepingStatus === "INSPECTED"))
          .map((x) => ({ id: x.id, label: `${x.number} · ${x.roomType.name}${x.roomTypeId !== l.roomTypeId ? " (different type)" : ""}` })),
      })))
    : [];

  return (
    <>
      <PageHeader
        back={{ href: "/reservations", label: "Reservations" }}
        title={<span className="flex flex-wrap items-center gap-2">{r.reference} <StatusBadge status={r.status} />{r.isDemo && <Badge>Demo data</Badge>}{r.isGroup && <Badge tone="info">Group · {r.rooms.length} rooms</Badge>}</span>}
        description={`${fullName(r.guest)} · ${formatDate(r.checkIn)} → ${formatDate(r.checkOut)} · ${diffNights(r.checkIn, r.checkOut)} night(s) · ${titleCase(r.source)}`}
        actions={<>
          {open && ctx.can("frontdesk.checkin") && r.checkIn <= ctx.today && <LinkButton href={`/frontdesk/checkin/${r.id}`}><LogIn className="size-4" /> Check in</LinkButton>}
          {inHouse && ctx.can("frontdesk.checkout") && <LinkButton href={`/frontdesk/checkout/${r.id}`}><LogOut className="size-4" /> Check out</LinkButton>}
          {(open || inHouse) && ctx.can("frontdesk.payment") && <PaymentDialog reservationId={r.id} suggested={expectedBalance.toFixed(2)} />}
          {(open || inHouse) && ctx.can("reservations.edit") && <DatesDialog id={r.id} checkIn={toDateOnlyString(r.checkIn)} checkOut={toDateOnlyString(r.checkOut)} inHouse={inHouse} />}
          {ctx.can("reservations.edit") && !["CHECKED_OUT", "CANCELLED", "NO_SHOW"].includes(r.status) && <EditDetailsDialog canDiscount={ctx.can("reservations.override_rate")} r={{ id: r.id, source: r.source, specialRequests: r.specialRequests, notes: r.notes, companyName: r.companyName, groupName: r.groupName, discount: r.discountAmount.toFixed(2), status: r.status }} />}
          <LinkButton href={`/reservations/${r.id}/voucher`} variant="secondary" target="_blank"><FileText className="size-4" /> Voucher</LinkButton>
          {open && ctx.can("reservations.cancel") && <CancelDialog id={r.id} held={held.toFixed(2)} policy={ctx.property.cancellationPolicy} canRefund={ctx.can("frontdesk.payment")} />}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Rooms" />
            <Table>
              <THead><tr><TH>Type</TH><TH>Room</TH><TH>Dates</TH><TH>Guests</TH><TH>Status</TH><TH className="text-right">Charges</TH><TH /></tr></THead>
              <TBody>
                {r.rooms.map((l) => {
                  const choice = roomChoices.find((c) => c.lineId === l.id);
                  return (
                    <TR key={l.id}>
                      <TD>{l.roomType.name}</TD>
                      <TD>{l.room ? <Link className="text-brand hover:underline" href={`/rooms/${l.room.id}`}>{l.room.number}</Link> : <span className="text-warn">Unassigned</span>}</TD>
                      <TD className="whitespace-nowrap">{formatDate(l.checkIn)} → {formatDate(l.checkOut)}</TD>
                      <TD>{l.adults}A {l.children ? `${l.children}C` : ""}</TD>
                      <TD><StatusBadge status={l.status} /></TD>
                      <TD className="text-right tabular-nums">{money(l.nights.reduce((a, n) => a.plus(n.rate).plus(n.extraCharge), D(0)))}<div className="text-[11px] text-ink-3">{l.nights.filter((n) => n.postedAt).length}/{l.nights.length} nights posted</div></TD>
                      <TD className="text-right">{choice && <MoveRoomDialog lineId={l.id} current={l.roomId} rooms={choice.rooms} label={l.roomId ? "Change" : "Assign"} />}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader title={`Guest folio ${r.folio?.number ?? ""}`} description={r.folio?.status === "CLOSED" ? "Closed" : "Room nights are posted by the night audit and at check-out"} actions={r.folio?.invoices.map((i) => <LinkButton key={i.id} href={`/invoices/${i.id}`} variant="secondary" size="sm" target="_blank">{i.number}</LinkButton>)} />
            {txns.length ? (
              <Table>
                <THead><tr><TH>Date</TH><TH>Description</TH><TH className="text-right">Charge</TH><TH className="text-right">Credit</TH></tr></THead>
                <TBody>
                  {txns.map((t) => (
                    <TR key={t.id}>
                      <TD className="whitespace-nowrap text-ink-2">{formatDate(t.serviceDate)}</TD>
                      <TD>{t.description}</TD>
                      <TD className="text-right tabular-nums">{Number(t.amount) > 0 ? money(t.amount) : ""}</TD>
                      <TD className="text-right tabular-nums text-ok">{Number(t.amount) < 0 ? money(D(t.amount).negated()) : ""}</TD>
                    </TR>
                  ))}
                  <TR className="bg-muted/50 font-medium"><TD /><TD>Folio balance</TD><TD className="text-right tabular-nums" colSpan={2}>{money(folioBalance)}</TD></TR>
                </TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No charges or payments yet.</CardBody>}
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {r.events.map((e) => (
                  <li key={e.id}>
                    <div className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-brand-2" />
                    <div className="text-sm">{e.description}</div>
                    <div className="text-xs text-ink-3">{titleCase(e.type)} · {formatDateTime(e.createdAt, ctx.property.timeZone)}{e.userId ? ` · ${users.get(e.userId) ?? ""}` : ""}</div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Amounts" />
            <CardBody className="space-y-1.5 text-sm">
              {[["Room charges", r.roomTotal], ["Extra guests", r.extrasTotal], ["Discount", D(r.discountAmount).negated()], ["Service charge", r.serviceCharge], ["Taxes", r.taxTotal]].filter(([, v]) => !D(v as string).isZero()).map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-ink-2"><span>{k as string}</span><span className="tabular-nums">{money(v)}</span></div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(r.grandTotal)}</span></div>
              <div className="flex justify-between text-ok"><span>Paid</span><span className="tabular-nums">{money(paid)}</span></div>
              {!held.isZero() && <div className="flex justify-between text-xs text-ink-3"><span>of which held as deposit</span><span className="tabular-nums">{money(held)}</span></div>}
              {!["CANCELLED", "NO_SHOW"].includes(r.status) && <div className={`flex justify-between font-semibold ${expectedBalance.greaterThan(0) ? "text-warn" : ""}`}><span>Balance</span><span className="tabular-nums">{money(expectedBalance)}</span></div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Guest" actions={<LinkButton href={`/guests/${r.guestId}`} variant="ghost" size="sm">Profile</LinkButton>} />
            <CardBody>
              <DescriptionList className="sm:grid-cols-1" items={[
                ["Name", <span key="n" className="flex items-center gap-1.5">{fullName(r.guest)}{r.guest.isVip && <Badge tone="warn">VIP</Badge>}</span>],
                ["Phone", r.guest.phone], ["Email", r.guest.email], ["Nationality", r.guest.nationality], ["Company", r.companyName ?? r.guest.company],
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Requests & notes" />
            <CardBody>
              <DescriptionList className="sm:grid-cols-1" items={[["Special requests", r.specialRequests], ["Internal notes", r.notes], ...(r.cancelReason ? [["Cancellation reason", r.cancelReason] as [string, string]] : [])]} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
