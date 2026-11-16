import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { D, formatMoney, sum } from "@/lib/money";
import { formatClock } from "@/lib/time";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { cancelEventAction, eventItemAction, eventPaymentAction, eventStatusAction, removeEventItemAction } from "@/server/actions/sales";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, PostButton, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Event" };
export const dynamic = "force-dynamic";

const METHODS: Opt[] = [["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["CHEQUE", "Cheque"], ["ONLINE", "Online"]];
const ACCOUNTS: Opt[] = [["4400", "Event revenue (catering, décor)"], ["4300", "Conference (hire, AV equipment)"], ["4100", "Food & beverage"], ["4600", "Other services"]];

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("events.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const e = await prisma.eventBooking.findFirst({
    where: { id, propertyId: ctx.property.id },
    include: { venue: true, items: { orderBy: { id: "asc" } }, folio: { include: { transactions: { orderBy: { createdAt: "asc" } }, payments: { orderBy: { receivedAt: "asc" } }, invoices: true } } },
  });
  if (!e) notFound();
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const open = ["TENTATIVE", "CONFIRMED"].includes(e.status);
  const itemsTotal = sum(e.items.map((i) => i.amount));
  const sc = itemsTotal.times(ctx.property.serviceChargeRate).dividedBy(100);
  const tax = itemsTotal.plus(sc).times(ctx.property.taxRate).dividedBy(100);
  const deposits = sum(e.folio.payments.map((p) => (p.kind === "REFUND" ? D(p.amount).negated() : D(p.amount))));
  const balance = sum(e.folio.transactions.map((t) => t.amount));
  const canEdit = ctx.can("events.edit");
  const canPay = ctx.can("events.edit");
  return (
    <>
      <PageHeader
        title={e.title}
        description={`${e.number} · ${titleCase(e.eventType)} · ${e.venue.name} · ${formatDate(e.date)} ${formatClock(e.startMinute)}–${formatClock(e.endMinute)}`}
        back={{ href: "/events", label: "Events" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {e.status === "TENTATIVE" && canEdit && <PostButton action={eventStatusAction} fields={{ id: e.id, to: "CONFIRMED" }} label="Confirm" variant="primary" />}
            {e.status === "CONFIRMED" && canEdit && <PostButton action={eventStatusAction} fields={{ id: e.id, to: "COMPLETED" }} label="Complete & invoice" variant="primary" confirm="Post all items to the event folio and issue the invoice?" />}
            {e.invoiceId && <LinkButton href={`/invoices/${e.invoiceId}`} variant="secondary" size="sm">Invoice</LinkButton>}
            {open && ctx.can("events.delete") && (
              <FormDialog action={cancelEventAction} title={`Cancel ${e.number}`} trigger="Cancel event" triggerVariant="danger-outline" submitLabel="Cancel event" description="Any deposit held is refunded."
                fields={[{ name: "eventId", label: "", type: "hidden", defaultValue: e.id }, { name: "reason", label: "Reason", required: true, span: 4 }, ...(deposits.greaterThan(0) ? [{ name: "refundMethod", label: `Refund ${money(deposits)} by`, type: "select" as const, options: METHODS, required: true, defaultValue: "BANK_TRANSFER", span: 4 as const }] : [])]} />
            )}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Billable items" description="Posted to the folio when the event is completed." actions={open && canEdit && (
              <FormDialog action={eventItemAction} title="Add an item" trigger="Add item"
                fields={[{ name: "eventId", label: "", type: "hidden", defaultValue: e.id }, { name: "description", label: "Description", required: true, span: 4, placeholder: "Lunch buffet" }, { name: "quantity", label: "Quantity", type: "number", required: true, defaultValue: e.attendees }, { name: "unitPrice", label: "Unit price", type: "number", required: true }, { name: "revenueAccount", label: "Revenue", type: "select", options: ACCOUNTS, required: true, defaultValue: "4400", span: 4 }]} />
            )} />
            <Table>
              <THead><tr><TH>Item</TH><TH className="text-right">Qty</TH><TH className="text-right">Price</TH><TH className="text-right">Amount</TH><TH /></tr></THead>
              <TBody>
                {e.items.map((i) => (
                  <TR key={i.id}>
                    <TD>{i.description}{i.postedAt && <span className="ml-2 text-[10px] text-ok">posted</span>}</TD>
                    <TD className="text-right tabular-nums">{D(i.quantity).toString()}</TD><TD className="text-right tabular-nums">{money(i.unitPrice)}</TD><TD className="text-right tabular-nums">{money(i.amount)}</TD>
                    <TD className="text-right">{open && canEdit && !i.postedAt && <PostButton action={removeEventItemAction} fields={{ id: i.id }} label="Remove" variant="ghost" />}</TD>
                  </TR>
                ))}
                <TR><TD colSpan={3} className="text-right text-ink-2">Subtotal</TD><TD className="text-right tabular-nums">{money(itemsTotal)}</TD><TD /></TR>
                {e.status !== "COMPLETED" && <>
                  <TR><TD colSpan={3} className="text-right text-ink-2">Service charge ({ctx.property.serviceChargeRate.toString()}%)</TD><TD className="text-right tabular-nums">{money(sc)}</TD><TD /></TR>
                  <TR><TD colSpan={3} className="text-right text-ink-2">Tax ({ctx.property.taxRate.toString()}%)</TD><TD className="text-right tabular-nums">{money(tax)}</TD><TD /></TR>
                  <TR className="font-semibold"><TD colSpan={3} className="text-right">Estimated total</TD><TD className="text-right tabular-nums">{money(itemsTotal.plus(sc).plus(tax))}</TD><TD /></TR>
                </>}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={`Folio ${e.folio.number}`} description={e.status === "COMPLETED" ? "Final charges and payments." : "Deposits are held as a liability until the event is completed."} actions={canPay && e.status !== "CANCELLED" && (open || balance.greaterThan(0)) && (
              <FormDialog action={eventPaymentAction} title={open ? "Take a deposit" : "Collect payment"} trigger={open ? "Take deposit" : "Collect balance"}
                fields={[{ name: "eventId", label: "", type: "hidden", defaultValue: e.id }, { name: "kind", label: "", type: "hidden", defaultValue: open ? "DEPOSIT" : "SETTLEMENT" }, { name: "amount", label: "Amount", type: "number", required: true, defaultValue: open ? "" : balance.toFixed(2) }, { name: "method", label: "Method", type: "select", options: METHODS, required: true, defaultValue: "BANK_TRANSFER" }, { name: "reference", label: "Reference", span: 4 }]} />
            )} />
            <Table>
              <THead><tr><TH>Date</TH><TH>Description</TH><TH className="text-right">Amount</TH></tr></THead>
              <TBody>
                {e.folio.transactions.length === 0 && <TR><TD colSpan={3} className="text-center text-sm text-ink-3">No folio activity yet</TD></TR>}
                {e.folio.transactions.map((t) => <TR key={t.id}><TD className="text-xs">{formatDate(t.serviceDate)}</TD><TD className="text-sm">{t.description}</TD><TD className={`text-right tabular-nums ${D(t.amount).isNegative() ? "text-ok" : ""}`}>{money(t.amount)}</TD></TR>)}
                <TR className="bg-muted/50 font-semibold"><TD /><TD>{balance.isNegative() ? "Credit" : "Balance due"}</TD><TD className="text-right tabular-nums">{money(balance.abs())}</TD></TR>
              </TBody>
            </Table>
          </Card>
        </div>
        <Card>
          <CardHeader title="Booking" />
          <CardBody>
            <DescriptionList items={[
              ["Client", e.clientName], ["Company", e.company ?? "—"], ["Email", e.email ?? "—"], ["Phone", e.phone ?? "—"],
              ["Attendees", `${e.attendees} (venue holds ${e.venue.capacity})`], ["Deposits received", money(deposits)],
              ["Invoice", e.folio.invoices[0] ? <Link key="i" href={`/invoices/${e.folio.invoices[0].id}`} className="underline">{e.folio.invoices[0].number}</Link> : "—"],
              ["Booked", formatDateTime(e.createdAt, ctx.property.timeZone)], ["Notes", e.notes ?? "—"],
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
