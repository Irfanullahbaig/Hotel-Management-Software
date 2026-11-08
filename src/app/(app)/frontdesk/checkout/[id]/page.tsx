import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { previewCheckOut } from "@/server/services/frontdesk";
import { checkOutAction } from "@/server/actions/frontdesk";
import { toMessage } from "@/server/actions/util";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CheckOutForm } from "@/components/frontdesk/checkout-form";

export const metadata = { title: "Check out" };
export const dynamic = "force-dynamic";

export default async function CheckOutPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("frontdesk.checkout");
  if (!ctx) return <Forbidden />;
  const r = await prisma.reservation.findFirst({ where: { id: (await params).id, propertyId: ctx.property.id }, include: { guest: true, rooms: { include: { room: true } } } });
  if (!r) notFound();
  const header = <PageHeader back={{ href: `/reservations/${r.id}`, label: r.reference }} title={`Check out ${fullName(r.guest)}`} description={`${r.reference} · rooms ${r.rooms.filter((l) => l.status === "CHECKED_IN").map((l) => l.room?.number).join(", ")} · ${formatDate(r.checkIn)} → ${formatDate(r.checkOut)}`} />;
  if (r.status !== "CHECKED_IN") return <>{header}<Card><CardBody>This reservation is not in house.</CardBody></Card></>;
  let preview;
  try {
    preview = await previewCheckOut(prisma, { userId: ctx.user.id, propertyId: ctx.property.id }, r.id, ctx.today);
  } catch (e) {
    return <>{header}<Card><CardBody className="text-danger">Check-out is not possible yet: {toMessage(e)}</CardBody></Card></>;
  }
  const money = (v: string | number) => formatMoney(v, ctx.property.currency);
  const charges = preview.txns.filter((t) => Number(t.amount) > 0);
  const credits = preview.txns.filter((t) => Number(t.amount) < 0);
  return (
    <>
      {header}
      {preview.notes.map((n) => <p key={n} className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{n}</p>)}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Final folio" description={preview.newlyPosted ? `${preview.newlyPosted} remaining night(s), service charge and tax will be posted on check-out` : "All nights are already posted"} />
          <Table>
            <THead><tr><TH>Date</TH><TH>Description</TH><TH className="text-right">Amount</TH></tr></THead>
            <TBody>
              {charges.map((t) => <TR key={t.id}><TD className="whitespace-nowrap text-ink-2">{formatDate(t.date)}</TD><TD>{t.description}</TD><TD className="text-right tabular-nums">{money(t.amount)}</TD></TR>)}
              <TR className="bg-muted/40 font-medium"><TD /><TD>Total charges</TD><TD className="text-right tabular-nums">{money(charges.reduce((a, t) => a + Number(t.amount), 0))}</TD></TR>
              {credits.map((t) => <TR key={t.id}><TD className="whitespace-nowrap text-ink-2">{formatDate(t.date)}</TD><TD>{t.description}</TD><TD className="text-right tabular-nums text-ok">{money(t.amount)}</TD></TR>)}
            </TBody>
          </Table>
        </Card>
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader title="Settlement" />
          <CardBody className="space-y-3">
            <div className="flex justify-between text-base font-semibold"><span>Balance due</span><span className="tabular-nums">{money(preview.balance)}</span></div>
            <CheckOutForm reservationId={r.id} balance={Number(preview.balance)} currency={ctx.property.currency} canPay={ctx.can("frontdesk.payment")} canAllowBalance={ctx.can("frontdesk.allow_balance")} action={checkOutAction} />
            <p className="text-xs text-ink-3">On completion: invoice issued, deposits applied, payment posted to the ledger, reservation closed, room marked dirty and a cleaning task created.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
