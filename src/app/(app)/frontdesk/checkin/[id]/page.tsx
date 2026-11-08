import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { D, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { availableRooms, isReadyForCheckIn } from "@/server/services/availability";
import { checkInAction } from "@/server/actions/frontdesk";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckInForm } from "@/components/frontdesk/checkin-form";

export const metadata = { title: "Check in" };
export const dynamic = "force-dynamic";

export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("frontdesk.checkin");
  if (!ctx) return <Forbidden />;
  const r = await prisma.reservation.findFirst({ where: { id: (await params).id, propertyId: ctx.property.id }, include: { guest: { include: { documents: { orderBy: { createdAt: "desc" } } } }, rooms: { include: { roomType: true, room: true } }, folio: { include: { payments: true } } } });
  if (!r) notFound();
  const header = <PageHeader back={{ href: `/reservations/${r.id}`, label: r.reference }} title={`Check in ${fullName(r.guest)}`} description={`${r.reference} · ${formatDate(r.checkIn)} → ${formatDate(r.checkOut)} · ${r.adults} adults, ${r.children} children`} />;
  const problem = !["CONFIRMED", "PENDING"].includes(r.status) ? `This reservation is ${r.status.toLowerCase().replace("_", " ")}.` : r.checkIn > ctx.today ? `Arrival is ${formatDate(r.checkIn)}. Change the dates to check in early.` : r.checkOut <= ctx.today ? "The stay has already ended. Change the dates first." : null;
  if (problem) return <>{header}<Card><CardBody>{problem}</CardBody></Card></>;
  const pending = r.rooms.filter((l) => l.status === "RESERVED");
  const lines = await Promise.all(pending.map(async (l) => {
    const free = (await availableRooms(prisma, ctx.property.id, l.checkIn, l.checkOut, { excludeLineIds: [l.id], today: ctx.today })).filter((x) => isReadyForCheckIn(x, ctx.property.requireInspection));
    free.sort((a, b) => Number(b.roomTypeId === l.roomTypeId) - Number(a.roomTypeId === l.roomTypeId));
    return { id: l.id, type: l.roomType.name, assignedRoomId: l.roomId, assignedReady: !!l.roomId && free.some((x) => x.id === l.roomId), adults: l.adults, children: l.children, rooms: free.map((x) => ({ id: x.id, number: `${x.number} · ${x.roomType.name}`, sameType: x.roomTypeId === l.roomTypeId })) };
  }));
  const paid = (r.folio?.payments ?? []).reduce((a, p) => (p.kind === "REFUND" ? a.minus(p.amount) : a.plus(p.amount)), D(0));
  const doc = r.guest.documents[0];
  return (
    <>
      {header}
      {r.guest.isVip && <div className="mb-3"><Badge tone="warn">VIP guest</Badge> {r.guest.preferences && <span className="text-sm text-ink-2">Preferences: {r.guest.preferences}</span>}</div>}
      <CheckInForm reservationId={r.id} lines={lines} action={checkInAction} canPay={ctx.can("frontdesk.payment")} specialRequests={r.specialRequests}
        doc={doc ? { type: doc.type, number: ctx.can("guests.view_sensitive") ? doc.number : `••••${doc.number.slice(-4)}`, verified: !!doc.verifiedAt } : null}
        suggestedPayment={formatMoney(D(r.grandTotal).minus(paid), ctx.property.currency)} />
    </>
  );
}
