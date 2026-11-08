import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { DocumentShell } from "@/components/ui/document";
import { PrintButton } from "@/components/ui/print-button";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("reservations.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const inv = await prisma.invoice.findFirst({ where: { id, propertyId: ctx.property.id }, include: { items: { orderBy: { date: "asc" } }, folio: { include: { reservation: true, payments: { orderBy: { receivedAt: "asc" } } } } } });
  if (!inv) notFound();
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const res = inv.folio.reservation;
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-between">{res && <LinkButton href={`/reservations/${res.id}`} variant="ghost">← Back</LinkButton>}<PrintButton /></div>
      <DocumentShell property={ctx.property} title="Invoice" number={inv.number}>
        <div className="flex justify-between py-5 text-sm">
          <div><div className="text-xs text-ink-3">Bill to</div><div className="font-medium">{inv.billTo}</div>{res && <div className="text-ink-2">Reservation {res.reference}</div>}</div>
          <div className="text-right"><div className="text-xs text-ink-3">Issued</div><div>{formatDate(inv.issuedAt)}</div>{res && <div className="text-ink-2">Stay {formatDate(res.checkIn)} → {formatDate(res.checkOut)}</div>}</div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-border text-left text-xs text-ink-3"><th className="py-2">Date</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{inv.items.map((i) => <tr key={i.id} className="border-b border-border/60"><td className="py-1.5 whitespace-nowrap text-ink-2">{formatDate(i.date)}</td><td>{i.description}</td><td className="text-right tabular-nums">{money(i.amount)}</td></tr>)}</tbody>
        </table>
        <div className="ml-auto mt-4 w-72 space-y-1 text-sm">
          {[["Subtotal", inv.subtotal], ["Discount", inv.discount], ["Service charge", inv.serviceCharge], ["Tax", inv.tax]].map(([k, v]) => <div key={k as string} className="flex justify-between text-ink-2"><span>{k as string}</span><span className="tabular-nums">{money(v)}</span></div>)}
          <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{money(inv.total)}</span></div>
          <div className="flex justify-between text-ink-2"><span>Paid</span><span className="tabular-nums">{money(inv.paid)}</span></div>
          <div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular-nums">{money(inv.balance)}</span></div>
        </div>
        {inv.folio.payments.length > 0 && (
          <div className="mt-6 text-xs text-ink-3">
            <div className="mb-1 font-medium text-ink-2">Payments</div>
            {inv.folio.payments.map((p) => <div key={p.id}>{p.receiptNumber} · {formatDate(p.receivedAt)} · {p.kind.toLowerCase()} · {p.method.toLowerCase().replace("_", " ")} · {money(p.amount)}</div>)}
          </div>
        )}
      </DocumentShell>
    </div>
  );
}
