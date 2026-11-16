import { prisma } from "@/lib/db";
import { businessToday } from "@/lib/dates";
import { D, formatMoney, sum } from "@/lib/money";
import { pageAuth } from "@/server/auth/page";
import { balancesByAccount, profitAndLoss } from "@/server/services/accounting";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Group overview" };
export const dynamic = "force-dynamic";

export default async function GroupPage() {
  const ctx = await pageAuth("reports.view");
  if (!ctx) return <Forbidden />;
  const props = await prisma.property.findMany({ where: { id: { in: ctx.properties.map((p) => p.id) } }, orderBy: { name: "asc" } });
  const rows = await Promise.all(props.map(async (p) => {
    const today = businessToday(p.timeZone);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const [rooms, occupied, arrivals, pl, all, openComplaints] = await Promise.all([
      prisma.room.count({ where: { propertyId: p.id, isActive: true } }),
      prisma.reservationNight.count({ where: { date: today, reservationRoom: { status: { in: ["RESERVED", "CHECKED_IN"] }, reservation: { propertyId: p.id, status: { notIn: ["CANCELLED", "NO_SHOW"] } } } } }),
      prisma.reservation.count({ where: { propertyId: p.id, checkIn: today, status: { in: ["CONFIRMED", "PENDING"] } } }),
      balancesByAccount(prisma, [p.id], { from: monthStart, to: today }).then(profitAndLoss),
      balancesByAccount(prisma, [p.id]),
      prisma.guestFeedback.count({ where: { propertyId: p.id, kind: "COMPLAINT", status: "OPEN" } }),
    ]);
    const bal = (c: string) => all.find((r) => r.code === c)?.net ?? D(0);
    const roomRev = pl.income.find((r) => r.code === "4000")?.amount ?? D(0);
    const nightsMtd = await prisma.reservationNight.count({ where: { date: { gte: monthStart, lte: today }, postedAt: { not: null }, reservationRoom: { reservation: { propertyId: p.id } } } });
    const days = Math.round((today.getTime() - monthStart.getTime()) / 86400000) + 1;
    return {
      p, rooms, occupied, arrivals, openComplaints, revenue: pl.totalIncome, profit: pl.net, cash: bal("1000").plus(bal("1010")), ar: bal("1100"), ap: bal("2000").negated(),
      occ: rooms ? (occupied / rooms) * 100 : 0, adr: nightsMtd ? roomRev.dividedBy(nightsMtd) : D(0), revpar: rooms ? roomRev.dividedBy(rooms * days) : D(0),
    };
  }));
  // Mixed currencies are shown per property; totals only when every property shares one currency.
  const currencies = [...new Set(props.map((p) => p.currency))];
  const one = currencies.length === 1 ? currencies[0] : null;
  const m = (v: unknown, c: string) => formatMoney(v as string, c);
  const totalRooms = rows.reduce((a, r) => a + r.rooms, 0);
  return (
    <>
      <PageHeader title="Group overview" description={`${props.length} ${props.length === 1 ? "property" : "properties"} you can access. Month-to-date figures use each hotel's own business date.${one ? "" : " Totals are not added up because the hotels use different currencies."}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Rooms" value={totalRooms} />
        <Stat label="Occupancy tonight" value={`${totalRooms ? Math.round((rows.reduce((a, r) => a + r.occupied, 0) / totalRooms) * 100) : 0}%`} />
        <Stat label="Arrivals today" value={rows.reduce((a, r) => a + r.arrivals, 0)} />
        {one && <Stat label="Revenue MTD" value={m(sum(rows.map((r) => r.revenue)), one)} />}
        {one && <Stat label="Net profit MTD" value={m(sum(rows.map((r) => r.profit)), one)} tone={sum(rows.map((r) => r.profit)).isNegative() ? "danger" : "ok"} />}
      </div>
      <Card>
        <CardHeader title="By property" description="Switch property from the top bar to work in a hotel." />
        <div className="overflow-x-auto">
          <Table>
            <THead><tr><TH>Property</TH><TH className="text-right">Rooms</TH><TH className="text-right">Occ. tonight</TH><TH className="text-right">Arrivals</TH><TH className="text-right">ADR MTD</TH><TH className="text-right">RevPAR MTD</TH><TH className="text-right">Revenue MTD</TH><TH className="text-right">Profit MTD</TH><TH className="text-right">Cash + bank</TH><TH className="text-right">Receivable</TH><TH className="text-right">Payable</TH><TH className="text-right">Complaints</TH></tr></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.p.id} className={r.p.id === ctx.property.id ? "bg-brand-soft/30" : ""}>
                  <TD><div className="font-medium">{r.p.name}</div><div className="text-[11px] text-ink-3">{r.p.code} · {r.p.currency}</div></TD>
                  <TD className="text-right tabular-nums">{r.rooms}</TD>
                  <TD className="text-right tabular-nums">{Math.round(r.occ)}%</TD>
                  <TD className="text-right tabular-nums">{r.arrivals}</TD>
                  <TD className="text-right tabular-nums">{m(r.adr, r.p.currency)}</TD>
                  <TD className="text-right tabular-nums">{m(r.revpar, r.p.currency)}</TD>
                  <TD className="text-right tabular-nums">{m(r.revenue, r.p.currency)}</TD>
                  <TD className={`text-right tabular-nums ${r.profit.isNegative() ? "text-danger" : ""}`}>{m(r.profit, r.p.currency)}</TD>
                  <TD className="text-right tabular-nums">{m(r.cash, r.p.currency)}</TD>
                  <TD className="text-right tabular-nums">{m(r.ar, r.p.currency)}</TD>
                  <TD className="text-right tabular-nums">{m(r.ap, r.p.currency)}</TD>
                  <TD className={`text-right tabular-nums ${r.openComplaints ? "text-danger" : ""}`}>{r.openComplaints}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
