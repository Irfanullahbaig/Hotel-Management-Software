import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { diffNights, formatDate } from "@/lib/dates";
import { formatMoney, D } from "@/lib/money";
import { fullName, titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { DocumentShell } from "@/components/ui/document";
import { PrintButton } from "@/components/ui/print-button";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Booking confirmation" };

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("reservations.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const r = await prisma.reservation.findFirst({ where: { id, propertyId: ctx.property.id }, include: { guest: true, rooms: { include: { roomType: true, room: true } }, folio: { include: { payments: true } } } });
  if (!r) notFound();
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const paid = (r.folio?.payments ?? []).reduce((a, p) => (p.kind === "REFUND" ? a.minus(p.amount) : a.plus(p.amount)), D(0));
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-between"><LinkButton href={`/reservations/${r.id}`} variant="ghost">← Back</LinkButton><PrintButton /></div>
      <DocumentShell property={ctx.property} title={r.status === "CANCELLED" ? "Cancellation notice" : "Booking confirmation"} number={r.reference}>
        <div className="grid grid-cols-2 gap-6 py-5 text-sm">
          <div><div className="text-xs text-ink-3">Guest</div><div className="font-medium">{fullName(r.guest)}</div><div className="text-ink-2">{r.guest.email}</div><div className="text-ink-2">{r.guest.phone}</div></div>
          <div className="text-right"><div className="text-xs text-ink-3">Booked on</div><div>{formatDate(r.createdAt)}</div><div className="mt-2 text-xs text-ink-3">Status</div><div>{titleCase(r.status)}</div></div>
          <div><div className="text-xs text-ink-3">Arrival</div><div className="font-medium">{formatDate(r.checkIn)} from {ctx.property.checkInTime}</div></div>
          <div className="text-right"><div className="text-xs text-ink-3">Departure</div><div className="font-medium">{formatDate(r.checkOut)} by {ctx.property.checkOutTime}</div></div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-border text-left text-xs text-ink-3"><th className="py-2">Room</th><th>Guests</th><th className="text-right">Nights</th></tr></thead>
          <tbody>{r.rooms.filter((l) => l.status !== "CANCELLED").map((l) => <tr key={l.id} className="border-b border-border"><td className="py-2">{l.roomType.name}{l.room ? ` (room ${l.room.number})` : ""}</td><td>{l.adults} adults{l.children ? `, ${l.children} children` : ""}</td><td className="text-right">{diffNights(l.checkIn, l.checkOut)}</td></tr>)}</tbody>
        </table>
        <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>Total</span><span className="font-semibold">{money(r.grandTotal)}</span></div>
          <div className="flex justify-between text-ink-2"><span>Paid</span><span>{money(paid)}</span></div>
          <div className="flex justify-between font-medium"><span>Balance due</span><span>{money(D(r.grandTotal).minus(paid))}</span></div>
        </div>
        {r.specialRequests && <p className="mt-5 text-sm"><span className="text-ink-3">Special requests:</span> {r.specialRequests}</p>}
        {ctx.property.cancellationPolicy && <p className="mt-5 border-t border-border pt-4 text-xs text-ink-3">Cancellation policy: {ctx.property.cancellationPolicy}</p>}
      </DocumentShell>
    </div>
  );
}
