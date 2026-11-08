"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { quoteAction, searchGuestsAction, type QuoteResult } from "@/server/actions/reservations";
import type { ActionState } from "@/server/actions/types";

type Line = { key: string; roomTypeId: string; roomId: string; adults: number; children: number };
type GuestHit = Awaited<ReturnType<typeof searchGuestsAction>>[number];

const SOURCES = [["DIRECT", "Direct"], ["PHONE", "Phone"], ["WALK_IN", "Walk-in"], ["WEBSITE", "Website"], ["TRAVEL_AGENT", "Travel agent"], ["CORPORATE", "Corporate"], ["BOOKING_COM", "Booking.com"], ["EXPEDIA", "Expedia"], ["AGODA", "Agoda"], ["AIRBNB", "Airbnb"], ["OTHER_OTA", "Other OTA"]];
const METHODS = [["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["MOBILE_WALLET", "Mobile wallet"], ["CHEQUE", "Cheque"], ["ONLINE", "Online"]];
const ID_TYPES = [["PASSPORT", "Passport"], ["NATIONAL_ID", "National ID"], ["DRIVING_LICENSE", "Driving licence"], ["OTHER", "Other"]];
const addDaysStr = (s: string, n: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export function BookingForm({ mode, today, currency, canDiscount, canPay, action }: { mode: "reservation" | "walkin"; today: string; currency: string; canDiscount: boolean; canPay: boolean; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const walkin = mode === "walkin";
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDaysStr(today, 1));
  const [lines, setLines] = useState<Line[]>([{ key: "l0", roomTypeId: "", roomId: "", adults: 2, children: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [pending, start] = useTransition();
  const [guest, setGuest] = useState<GuestHit | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GuestHit[]>([]);
  const money = (v: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(v));

  useEffect(() => {
    const t = setTimeout(() => {
      start(async () => {
        setQuote(await quoteAction({ checkIn, checkOut, lines: lines.filter((l) => l.roomTypeId).map((l) => ({ roomTypeId: l.roomTypeId, adults: l.adults, children: l.children })), discount }));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [checkIn, checkOut, lines, discount]);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => setHits(await searchGuestsAction(q)), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Default the first line to the first available type once we know the inventory.
  useEffect(() => {
    if (quote?.types && lines.some((l) => !l.roomTypeId)) {
      const first = quote.types.find((t) => t.available > 0) ?? quote.types[0];
      if (first) setLines((ls) => ls.map((l) => (l.roomTypeId ? l : { ...l, roomTypeId: first.id })));
    }
  }, [quote, lines]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.roomTypeId, (m.get(l.roomTypeId) ?? 0) + 1);
    return m;
  }, [lines]);
  const overbooked = quote?.types?.filter((t) => (used.get(t.id) ?? 0) > t.available) ?? [];
  const missingRoom = walkin && lines.some((l) => !l.roomId);

  return (
    <ActionForm action={action} className="grid gap-4 lg:grid-cols-3">
      {(state) => (
        <>
          <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ roomTypeId, roomId, adults, children }) => ({ roomTypeId, roomId: roomId || null, adults, children })))} />
          {walkin && <input type="hidden" name="roomId" value={lines[0]?.roomId ?? ""} />}
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader title="Stay" />
              <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Check-in" required>
                  <Input type="date" name="checkIn" value={checkIn} min={today} readOnly={walkin} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDaysStr(e.target.value, 1)); }} required />
                </Field>
                <Field label="Check-out" required><Input type="date" name="checkOut" value={checkOut} min={addDaysStr(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} required /></Field>
                <Field label="Nights"><Input value={quote?.nights ?? "—"} readOnly tabIndex={-1} /></Field>
                {!walkin ? (
                  <Field label="Booking source" required>
                    <Select name="source" defaultValue="DIRECT">{SOURCES.filter(([v]) => v !== "WALK_IN").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                  </Field>
                ) : <input type="hidden" name="source" value="WALK_IN" />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Rooms" description={walkin ? "Only rooms that are clean, inspected and vacant can be assigned." : "Assigning a specific room is optional until check-in."}
                actions={!walkin && <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, { key: `l${Date.now()}`, roomTypeId: "", roomId: "", adults: 2, children: 0 }])}><Plus className="size-4" /> Add room</Button>} />
              <CardBody className="space-y-3">
                {lines.map((l, i) => {
                  const t = quote?.types?.find((x) => x.id === l.roomTypeId);
                  const lq = l.roomTypeId ? quote?.lines?.[lines.filter((y) => y.roomTypeId).findIndex((y) => y.key === l.key)] : undefined;
                  const roomOptions = (t?.rooms ?? []).filter((r) => (!walkin || r.ready) && !lines.some((o) => o.key !== l.key && o.roomId === r.id));
                  return (
                    <div key={l.key} className="grid grid-cols-2 items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-12">
                      <Field label={`Room ${i + 1} type`} className="col-span-2 sm:col-span-4">
                        <Select value={l.roomTypeId} onChange={(e) => update(l.key, { roomTypeId: e.target.value, roomId: "" })} required>
                          <option value="" disabled>Select…</option>
                          {quote?.types?.map((x) => <option key={x.id} value={x.id} disabled={x.available === 0}>{x.name} · {x.available} left</option>)}
                        </Select>
                      </Field>
                      <Field label={walkin ? "Room" : "Room (optional)"} className="col-span-2 sm:col-span-3">
                        <Select value={l.roomId} onChange={(e) => update(l.key, { roomId: e.target.value })} required={walkin}>
                          <option value="">{walkin ? "Select a ready room…" : "Assign later"}</option>
                          {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.number}{!r.ready ? " (not ready)" : ""}</option>)}
                        </Select>
                      </Field>
                      <Field label="Adults" className="sm:col-span-2"><Input type="number" min={1} max={t?.maxAdults ?? 10} value={l.adults} onChange={(e) => update(l.key, { adults: Number(e.target.value) })} /></Field>
                      <Field label="Children" className="sm:col-span-2"><Input type="number" min={0} max={t?.maxChildren ?? 10} value={l.children} onChange={(e) => update(l.key, { children: Number(e.target.value) })} /></Field>
                      <div className="flex items-end justify-end sm:col-span-1">
                        {lines.length > 1 && <Button variant="ghost" size="sm" aria-label="Remove room" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></Button>}
                      </div>
                      {lq && (
                        <div className="col-span-2 text-xs text-ink-3 sm:col-span-12">
                          {lq.nightly.length} night(s): {[...new Set(lq.nightly.map((n) => `${n.name} ${money(n.rate)}`))].join(", ")}{Number(lq.nightly[0]?.extra) > 0 && ` + extra guests ${money(lq.nightly[0].extra)}/night`} · <span className="font-medium text-ink-2">{money(lq.subtotal)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {overbooked.map((t) => <p key={t.id} className="text-sm text-danger">Only {t.available} {t.name} available for these dates.</p>)}
                {quote && !quote.ok && <p className="text-sm text-danger">{quote.error}</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Guest" description={guest ? undefined : "Search for a returning guest, or enter a new one. Matching email or phone links to the existing profile."} />
              <CardBody className="space-y-3">
                {guest ? (
                  <div className="flex items-center justify-between rounded-md bg-brand-soft px-3 py-2">
                    <div><span className="font-medium">{guest.name}</span> {guest.isVip && <Badge tone="warn">VIP</Badge>}<div className="text-xs text-ink-2">{[guest.email, guest.phone].filter(Boolean).join(" · ")}</div></div>
                    <input type="hidden" name="guestId" value={guest.id} />
                    <Button variant="ghost" size="sm" onClick={() => setGuest(null)}><X className="size-4" /> Change</Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search returning guests by name, email or phone" className="pl-8" aria-label="Search guests" />
                      {hits.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                          {hits.map((h) => (
                            <li key={h.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { setGuest(h); setQ(""); setHits([]); }}>
                              <span className="font-medium">{h.name}</span> <span className="text-xs text-ink-3">{[h.email, h.phone].filter(Boolean).join(" · ")}</span>
                            </button></li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="First name" required className="col-span-2"><Input name="firstName" required autoComplete="off" /></Field>
                      <Field label="Last name" required className="col-span-2"><Input name="lastName" required autoComplete="off" /></Field>
                      <Field label="Phone" className="col-span-2"><Input name="phone" type="tel" /></Field>
                      <Field label="Email" className="col-span-2"><Input name="email" type="email" /></Field>
                      <Field label="Nationality"><Input name="nationality" /></Field>
                      <Field label="Country"><Input name="country" /></Field>
                      <Field label="Address" className="col-span-2"><Input name="address" /></Field>
                      <Field label="Emergency contact" className="col-span-2"><Input name="emergencyContactName" /></Field>
                      <Field label="Emergency phone" className="col-span-2"><Input name="emergencyContactPhone" /></Field>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="ID type" required={walkin}><Select name={walkin ? "docType" : "idType"} defaultValue="PASSPORT">{ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                  <Field label="Passport / ID number" required={walkin}><Input name={walkin ? "docNumber" : "idNumber"} required={walkin} /></Field>
                  <Field label="Company" className="col-span-2"><Input name="companyName" /></Field>
                </div>
                {walkin && <Checkbox name="documentVerified" required label="I have seen and verified the guest's identification document" />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Requests & notes" />
              <CardBody className="grid gap-3 sm:grid-cols-2">
                <Field label="Special requests"><Textarea name="specialRequests" placeholder="Visible to front desk and housekeeping" /></Field>
                <Field label="Internal notes"><Textarea name="notes" /></Field>
                {!walkin && lines.length > 1 && <Field label="Group name"><Input name="groupName" /></Field>}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="lg:sticky lg:top-20">
              <CardHeader title="Price" description={pending ? "Updating…" : "Live from rates and availability"} />
              <CardBody className="space-y-1.5 text-sm">
                {quote?.totals ? (
                  <>
                    <Row k="Room charges" v={money(quote.totals.roomTotal)} />
                    {Number(quote.totals.extras) > 0 && <Row k="Extra guests" v={money(quote.totals.extras)} />}
                    {Number(quote.totals.discount) > 0 && <Row k="Discount" v={`− ${money(quote.totals.discount)}`} />}
                    <Row k="Service charge" v={money(quote.totals.serviceCharge)} />
                    <Row k="Taxes" v={money(quote.totals.tax)} />
                    <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{money(quote.totals.grandTotal)}</span></div>
                  </>
                ) : <p className="text-ink-3">Select dates and rooms.</p>}
                {canDiscount && (
                  <Field label="Discount (before tax)" className="pt-3"><Input name="discount" type="number" min={0} step="0.01" value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></Field>
                )}
                {!canDiscount && <input type="hidden" name="discount" value="0" />}
                {canPay && (
                  <div className="grid grid-cols-2 gap-2 pt-3">
                    <Field label={walkin ? "Payment now" : "Advance payment"}><Input name="depositAmount" type="number" min={0} step="0.01" placeholder="0.00" /></Field>
                    <Field label="Method"><Select name="depositMethod" defaultValue="CASH">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                    <Field label="Payment reference" className="col-span-2"><Input name="depositReference" placeholder="Card slip / transfer ref." /></Field>
                  </div>
                )}
                {!canPay && <><input type="hidden" name="depositAmount" value="0" /><input type="hidden" name="depositMethod" value="CASH" /></>}
                {!walkin && (
                  <Field label="Status" className="pt-2">
                    <Select name="status" defaultValue="CONFIRMED"><option value="CONFIRMED">Confirmed</option><option value="PENDING">Pending (awaiting guarantee)</option></Select>
                  </Field>
                )}
                <div className="pt-3"><FormMessage state={state} /></div>
                <SubmitButton className="mt-2 w-full" disabled={!quote?.ok || overbooked.length > 0 || missingRoom || lines.some((l) => !l.roomTypeId)} pendingText={walkin ? "Checking in…" : "Creating…"}>
                  {walkin ? "Create & check in" : "Create reservation"}
                </SubmitButton>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-ink-2"><span>{k}</span><span className="tabular-nums">{v}</span></div>;
}
