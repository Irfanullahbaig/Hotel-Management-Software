import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { RANGE_OPTIONS, rangeLabel, resolveRange } from "@/lib/ranges";
import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { getDashboard } from "@/server/services/dashboard";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Input, Select } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { HBar, Movement, OccupancyTrend, RevenueTrend } from "@/components/dashboard/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const ACCOUNT_LABEL: Record<string, string> = { "4000": "Rooms", "4100": "Restaurant", "4200": "Laundry", "4300": "Conference", "4400": "Events", "4500": "Spa", "4600": "Other services", "4650": "Service charge", "4900": "Discounts" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const ctx = await pageAuth("dashboard.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const range = resolveRange(sp.range, ctx.today, sp);
  const d = await getDashboard(prisma, ctx.property.id, ctx.today, range);
  const cur = ctx.property.currency;
  const money = (v: number) => formatMoney(v, cur);
  const showFinance = ctx.can("finance.view") || ctx.can("finance.view_sensitive");
  const showFront = ctx.can("frontdesk.view") || ctx.can("reservations.view");
  const showRooms = ctx.can("rooms.view") || ctx.can("housekeeping.view");

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getUTCHours() < 12 ? "morning" : "afternoon"}, ${ctx.user.name.split(" ")[0]}`}
        description={`${ctx.property.name} · business date ${toDateOnlyString(ctx.today)} · figures for ${rangeLabel(range)}`}
        actions={
          <form className="flex flex-wrap items-center gap-2" method="get">
            <Select name="range" defaultValue={range.key} className="w-36" aria-label="Period">
              {RANGE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Input type="date" name="from" defaultValue={sp.from ?? toDateOnlyString(range.from)} className="w-36" aria-label="From" />
            <Input type="date" name="to" defaultValue={sp.to ?? toDateOnlyString(range.to)} className="w-36" aria-label="To" />
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        }
      />

      {showRooms && (
        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Total rooms" value={d.rooms.total} />
          <Stat label="Available" value={d.rooms.available} tone="ok" hint={d.rooms.inspectionPending ? `${d.rooms.inspectionPending} awaiting inspection` : undefined} />
          <Stat label="Occupied" value={d.rooms.occupied} tone="info" />
          <Stat label="Reserved today" value={d.rooms.reserved} />
          <Stat label="Dirty / cleaning" value={d.rooms.dirty} tone={d.rooms.dirty ? "danger" : undefined} />
          <Stat label="Maintenance / blocked" value={d.rooms.maintenance} tone={d.rooms.maintenance ? "warn" : undefined} />
        </section>
      )}
      {showFront && (
        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Today's check-ins" value={d.frontdesk.arrivalsToday} hint={`${d.frontdesk.arrivalsPending} still to arrive`} />
          <Stat label="Today's check-outs" value={d.frontdesk.departuresToday} hint={`${d.frontdesk.departuresPending} still to depart`} />
          <Stat label="Current guests" value={d.frontdesk.currentGuests} />
          <Stat label="Reservations made" value={d.reservations.total} hint="in selected period" />
          <Stat label="Pending reservations" value={d.reservations.pending} tone={d.reservations.pending ? "warn" : undefined} />
          <Stat label="Cancelled / no-show" value={d.reservations.cancelled} />
        </section>
      )}
      {showFinance && (
        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Today's revenue" value={money(d.finance.todayRevenue)} />
          <Stat label="Month-to-date revenue" value={money(d.finance.monthRevenue)} />
          <Stat label="Outstanding (guest ledger)" value={money(d.finance.outstanding)} tone={d.finance.outstanding > 0 ? "warn" : undefined} />
          <Stat label="Expenses" value={money(d.finance.expenses)} hint="in selected period" />
          <Stat label="Net profit" value={money(d.finance.netProfit)} tone={d.finance.netProfit >= 0 ? "ok" : "danger"} hint="revenue − expenses" />
          <Stat label="Occupancy" value={`${(d.kpi.occupancy * 100).toFixed(1)}%`} hint={`${d.kpi.soldNights} of ${d.kpi.availableRoomNights} room-nights`} />
          <Stat label="ADR" value={money(d.kpi.adr)} hint="room revenue ÷ nights charged" />
          <Stat label="RevPAR" value={money(d.kpi.revpar)} hint="room revenue ÷ available nights" />
          <Stat label="Period revenue" value={money(d.finance.rangeRevenue)} />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {showFinance && (
          <Card>
            <CardHeader title="Revenue" description="Posted to the ledger, by business date" />
            <CardBody className="h-64"><RevenueTrend data={d.charts.trend} currency={cur} /></CardBody>
          </Card>
        )}
        {showRooms && (
          <Card>
            <CardHeader title="Room occupancy" description="Room-nights sold vs. unsold" />
            <CardBody className="h-64"><OccupancyTrend data={d.charts.trend} /></CardBody>
          </Card>
        )}
        {showFront && (
          <Card>
            <CardHeader title="Check-in and check-out trend" />
            <CardBody className="h-64"><Movement data={d.charts.movement} /></CardBody>
          </Card>
        )}
        {showFront && (
          <Card>
            <CardHeader title="Bookings by channel" description="Reservations created in the period" />
            <CardBody className="h-64"><HBar data={d.charts.sources} valueLabel="Bookings" /></CardBody>
          </Card>
        )}
        {showFinance && (
          <Card>
            <CardHeader title="Room revenue by room type" description="Nights charged in the period" />
            <CardBody className="h-64"><HBar data={d.charts.revenueByType} valueLabel="Revenue" money={cur} /></CardBody>
          </Card>
        )}
        {showFinance && (
          <Card>
            <CardHeader title="Revenue by department" description="Income accounts in the ledger" />
            <CardBody className="h-64"><HBar data={d.charts.revenueByDepartment.map((r) => ({ name: ACCOUNT_LABEL[r.code] ?? r.code, value: r.value }))} valueLabel="Revenue" money={cur} /></CardBody>
          </Card>
        )}
        {showFinance && (
          <Card>
            <CardHeader title="Payments by method" description="Net of refunds" />
            <CardBody className="h-64"><HBar data={d.charts.paymentMethods} valueLabel="Collected" money={cur} /></CardBody>
          </Card>
        )}
        {showFront && (
          <Card>
            <CardHeader title="Guest nationality" description="Guests staying in the period" />
            <CardBody className="h-64"><HBar data={d.charts.nationalities} valueLabel="Guests" /></CardBody>
          </Card>
        )}
        {showFront && (
          <Card>
            <CardHeader title="Cancellations" description="By cancellation date" />
            <CardBody className="h-64"><HBar data={d.charts.cancellations.map((c) => ({ name: c.date, value: c.value }))} valueLabel="Cancelled" /></CardBody>
          </Card>
        )}
        {showFinance && (
          <Card>
            <CardHeader title="Top performing rooms" description="Assigned room-nights in the period" />
            {d.charts.topRooms.length ? (
              <Table>
                <THead><tr><TH>Room</TH><TH className="text-right">Nights</TH><TH className="text-right">Room revenue</TH></tr></THead>
                <TBody>
                  {d.charts.topRooms.map((r) => (
                    <TR key={r.room}><TD>{r.room}</TD><TD className="text-right tabular-nums">{r.nights}</TD><TD className="text-right tabular-nums">{money(r.revenue)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            ) : <CardBody className="text-xs text-ink-3">No assigned stays in this period.</CardBody>}
          </Card>
        )}
      </div>
      {!showFinance && !showFront && !showRooms && (
        <Card><CardBody>Your role has no dashboard widgets. <Link className="text-brand underline" href="/notifications">View notifications</Link>.</CardBody></Card>
      )}
      {showFinance && (
        <p className="mt-4 text-xs text-ink-3">
          Salaries post to the ledger when payroll is approved. Expense and department-cost analytics fill in as the Finance (Phase 3) module starts recording data. <LinkButton href="/finance" variant="ghost" size="sm">Open ledger</LinkButton>
        </p>
      )}
    </>
  );
}
