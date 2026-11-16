import { prisma } from "@/lib/db";
import { addDays, businessToday, diffNights, formatDate, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BusinessError } from "@/server/services/common";
import { searchStay } from "@/server/services/booking";
import { publicBookAction } from "@/server/actions/booking";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { InlineForm } from "@/components/ui/quick-form";

export const metadata = { title: "Book your stay" };
export const dynamic = "force-dynamic";

type SP = { hotel?: string; in?: string; out?: string; adults?: string; children?: string; promo?: string };

export default async function BookPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const hotels = await prisma.property.findMany({ where: { isActive: true, bookingEngineEnabled: true }, orderBy: { name: "asc" } });
  const property = hotels.find((h) => h.code === sp.hotel) ?? hotels[0];
  if (!property) return <main className="mx-auto max-w-xl p-8 text-center">Online booking is not available.</main>;
  const today = businessToday(property.timeZone);
  const parse = (v: string | undefined, f: Date) => { try { return v ? parseDateOnly(v) : f; } catch { return f; } };
  const checkIn = parse(sp.in, addDays(today, 1));
  const checkOut = parse(sp.out, addDays(checkIn, 2));
  const adults = Math.min(10, Math.max(1, Number(sp.adults) || 2));
  const children = Math.min(10, Math.max(0, Number(sp.children) || 0));
  const searched = !!sp.in;
  let search: Awaited<ReturnType<typeof searchStay>> | null = null;
  let error: string | null = null;
  if (searched) {
    try { search = await prisma.$transaction((tx) => searchStay(tx, property.id, { checkIn, checkOut, adults, children, promo: sp.promo || null, today }), { timeout: 20000 }); }
    catch (e) { error = e instanceof BusinessError ? e.message : "Search failed. Please try again."; }
  }
  const money = (v: unknown) => formatMoney(v as string, property.currency);
  const nights = diffNights(checkIn, checkOut);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div><div className="text-lg font-semibold">{property.name}</div><div className="text-xs text-ink-3">{[property.address, property.phone, property.email].filter(Boolean).join(" · ")}</div></div>
          {hotels.length > 1 && (
            <form method="get"><Select name="hotel" defaultValue={property.code} aria-label="Hotel">{hotels.map((h) => <option key={h.id} value={h.code}>{h.name}</option>)}</Select></form>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <form method="get" className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-6">
          <input type="hidden" name="hotel" value={property.code} />
          <label className="col-span-1 text-xs text-ink-3 sm:col-span-1">Arrive<Input type="date" name="in" defaultValue={toDateOnlyString(checkIn)} min={toDateOnlyString(today)} required /></label>
          <label className="col-span-1 text-xs text-ink-3 sm:col-span-1">Depart<Input type="date" name="out" defaultValue={toDateOnlyString(checkOut)} required /></label>
          <label className="text-xs text-ink-3">Adults<Input type="number" name="adults" min={1} max={10} defaultValue={adults} /></label>
          <label className="text-xs text-ink-3">Children<Input type="number" name="children" min={0} max={10} defaultValue={children} /></label>
          <label className="text-xs text-ink-3">Promo code<Input name="promo" defaultValue={sp.promo ?? ""} /></label>
          <div className="flex items-end"><Button type="submit" className="w-full">Check availability</Button></div>
        </form>
        {error && <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        {search?.promoError && <div role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{search.promoError}</div>}
        {!searched && <p className="text-center text-sm text-ink-3">Choose your dates to see available rooms and prices.</p>}
        {search && (
          <>
            <p className="text-sm text-ink-2">{formatDate(checkIn)} → {formatDate(checkOut)} · {nights} night{nights === 1 ? "" : "s"} · {adults} adult{adults === 1 ? "" : "s"}{children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}</p>
            {search.results.map((r) => (
              <section key={r.rt.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{r.rt.name}</h2>
                    {r.rt.description && <p className="mt-0.5 max-w-xl text-sm text-ink-2">{r.rt.description}</p>}
                    <p className="mt-1 text-xs text-ink-3">Up to {r.rt.maxOccupancy} guests{r.rt.bedConfiguration ? ` · ${r.rt.bedConfiguration}` : ""}{r.rt.sizeSqm ? ` · ${r.rt.sizeSqm.toString()} m²` : ""}</p>
                  </div>
                  <div className="text-right">
                    {r.totals ? (
                      <>
                        <div className="text-xl font-semibold">{money(r.totals.grandTotal)}</div>
                        <div className="text-xs text-ink-3">total incl. taxes & service{r.discount.greaterThan(0) && <span className="text-ok"> · promo −{money(r.discount)}</span>}</div>
                      </>
                    ) : <div className="text-sm text-ink-3">{r.reason}</div>}
                    {r.fits && r.free > 0 && r.free <= 3 && <div className="mt-1 text-xs font-medium text-danger">Only {r.free} left</div>}
                  </div>
                </div>
                {r.fits && r.free > 0 ? (
                  <details className="mt-3 border-t border-border pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-brand">Book this room</summary>
                    <div className="mt-3">
                      <InlineForm action={publicBookAction} submitLabel="Request booking" resetOnSuccess
                        fields={[
                          { name: "propertyId", label: "", type: "hidden", defaultValue: property.id }, { name: "roomTypeId", label: "", type: "hidden", defaultValue: r.rt.id },
                          { name: "checkIn", label: "", type: "hidden", defaultValue: toDateOnlyString(checkIn) }, { name: "checkOut", label: "", type: "hidden", defaultValue: toDateOnlyString(checkOut) },
                          { name: "adults", label: "", type: "hidden", defaultValue: adults }, { name: "children", label: "", type: "hidden", defaultValue: children },
                          { name: "promo", label: "", type: "hidden", defaultValue: r.couponId ? sp.promo : "" },
                          { name: "firstName", label: "First name", required: true }, { name: "lastName", label: "Last name", required: true },
                          { name: "email", label: "Email", type: "email", required: true }, { name: "phone", label: "Phone", required: true },
                          { name: "country", label: "Country" },
                          { name: "specialRequests", label: "Special requests", type: "textarea" },
                          { name: "marketingConsent", label: "Send me offers and news from the hotel", type: "checkbox", span: 4 },
                          { name: "website", label: "", type: "hidden", defaultValue: "" },
                        ]} />
                      <p className="mt-2 text-xs text-ink-3">No payment is taken online. The hotel confirms your booking by email and payment is made at the hotel.</p>
                    </div>
                  </details>
                ) : r.fits && <p className="mt-2 text-sm text-danger">Sold out for these dates.</p>}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
