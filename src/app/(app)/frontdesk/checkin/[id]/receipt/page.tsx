import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { D, formatMoney } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { DocumentShell } from "@/components/ui/document";
import { PrintButton } from "@/components/ui/print-button";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Check-in receipt" };

export default async function CheckInReceipt({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("frontdesk.view");
  if (!ctx) return <Forbidden />;
  const r = await prisma.reservation.findFirst({ where: { id: (await params).id, propertyId: ctx.property.id }, include: { guest: true, rooms: { include: { room: true, roomType: true } }, folio: { include: { payments: true } } } });
  if (!r) notFound();
  const paid = (r.folio?.payments ?? []).reduce((a, p) => (p.kind === "REFUND" ? a.minus(p.amount) : a.plus(p.amount)), D(0));
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between rounded-md bg-ok-soft px-4 py-3 text-sm text-ok">
        <span>{fullName(r.guest)} is checked in. Rooms are now occupied and the folio is active.</span>
        <div className="flex gap-2"><LinkButton href="/frontdesk" variant="secondary">Front desk</LinkButton><PrintButton /></div>
      </div>
      <DocumentShell property={ctx.property} title="Check-in receipt" number={r.reference}>
        <div className="grid grid-cols-2 gap-4 py-5 text-sm">
          <div><div className="text-xs text-ink-3">Guest</div><div className="font-medium">{fullName(r.guest)}</div></div>
          <div className="text-right"><div className="text-xs text-ink-3">Checked in</div><div>{formatDateTime(r.rooms.find((l) => l.checkedInAt)?.checkedInAt, ctx.property.timeZone)}</div></div>
          <div><div className="text-xs text-ink-3">Stay</div><div>{formatDate(r.checkIn)} → {formatDate(r.checkOut)} (check-out by {ctx.property.checkOutTime})</div></div>
          <div className="text-right"><div className="text-xs text-ink-3">Room(s)</div><div className="font-medium">{r.rooms.filter((l) => l.status === "CHECKED_IN").map((l) => `${l.room?.number} (${l.roomType.name})`).join(", ")}</div></div>
        </div>
        <div className="ml-auto w-64 space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between"><span>Estimated total</span><span>{money(r.grandTotal)}</span></div>
          <div className="flex justify-between"><span>Deposits received</span><span>{money(paid)}</span></div>
        </div>
        <p className="mt-8 text-xs text-ink-3">Guest signature: ________________________________</p>
      </DocumentShell>
    </div>
  );
}
