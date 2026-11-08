import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { cn, fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { typeAvailability } from "@/server/services/availability";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { Select, Input } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/reservations/timeline";

export const metadata = { title: "Reservation calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ start?: string; days?: string; type?: string; view?: string }> }) {
  const ctx = await pageAuth("reservations.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  let start = addDays(ctx.today, -2);
  try { if (sp.start) start = parseDateOnly(sp.start); } catch { /* keep default */ }
  const days = [1, 7, 14, 31].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const end = addDays(start, days);
  const view = sp.view === "types" ? "types" : "rooms";
  const [rooms, lines, types] = await Promise.all([
    prisma.room.findMany({ where: { propertyId: ctx.property.id, isActive: true, roomTypeId: sp.type || undefined }, include: { roomType: true }, orderBy: [{ floor: "asc" }, { number: "asc" }] }),
    prisma.reservationRoom.findMany({
      where: { reservation: { propertyId: ctx.property.id }, status: { in: ["RESERVED", "CHECKED_IN", "CHECKED_OUT"] }, checkIn: { lt: end }, checkOut: { gt: start }, ...(sp.type ? { OR: [{ roomTypeId: sp.type }, { room: { roomTypeId: sp.type } }] } : {}) },
      include: { reservation: { include: { guest: true } } },
    }),
    prisma.roomType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { basePrice: "asc" } }),
  ]);
  const nav = (d: number) => `/reservations/calendar?${new URLSearchParams({ start: toDateOnlyString(addDays(start, d)), days: String(days), view, ...(sp.type ? { type: sp.type } : {}) })}`;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const typeGrid = view === "types"
    ? await Promise.all(types.map(async (t) => ({ t, cells: await Promise.all(dates.map((d) => typeAvailability(prisma, ctx.property.id, t.id, d, addDays(d, 1), { today: ctx.today }))), total: rooms.filter((r) => r.roomTypeId === t.id).length })))
    : [];

  return (
    <>
      <PageHeader back={{ href: "/reservations", label: "Reservations" }} title="Reservation calendar" description={view === "rooms" ? "Drag a booking to another room or date. Every move is validated against availability." : "Rooms of each type still available per night."}
        actions={<>
          <LinkButton href={nav(-days)} variant="secondary">←</LinkButton>
          <LinkButton href={`/reservations/calendar?days=${days}&view=${view}`} variant="secondary">Today</LinkButton>
          <LinkButton href={nav(days)} variant="secondary">→</LinkButton>
        </>}
      />
      <form className="mb-3 flex flex-wrap gap-2" method="get">
        <Input type="date" name="start" defaultValue={toDateOnlyString(start)} className="w-40" aria-label="Start date" />
        <Select name="days" defaultValue={String(days)} className="w-32" aria-label="Range"><option value="1">Day</option><option value="7">Week</option><option value="14">2 weeks</option><option value="31">Month</option></Select>
        <Select name="view" defaultValue={view} className="w-40" aria-label="View"><option value="rooms">Room-wise</option><option value="types">Room-type-wise</option></Select>
        <Select name="type" defaultValue={sp.type ?? ""} className="w-44" aria-label="Room type"><option value="">All room types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <Button type="submit" variant="secondary">Show</Button>
      </form>
      {view === "rooms" ? (
        <Timeline
          today={toDateOnlyString(ctx.today)} start={toDateOnlyString(start)} days={days} canMove={ctx.can("reservations.edit")}
          rooms={rooms.map((r) => ({ id: r.id, number: r.number, type: r.roomType.name, status: r.occupancyStatus }))}
          bars={lines.map((l) => ({ lineId: l.id, reservationId: l.reservationId, roomId: l.roomId, start: toDateOnlyString(l.checkIn), end: toDateOnlyString(l.checkOut), guest: fullName(l.reservation.guest), reference: l.reservation.reference, status: l.status, movable: l.status !== "CHECKED_OUT" && (l.status === "CHECKED_IN" || l.checkIn >= ctx.today) }))}
        />
      ) : (
        <Card>
          <CardHeader title="Availability by room type" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/50 text-xs text-ink-3"><th className="px-3 py-2 text-left">Type</th>{dates.map((d) => <th key={d.toISOString()} className={cn("px-1 py-2 text-center font-normal", toDateOnlyString(d) === toDateOnlyString(ctx.today) && "text-brand font-semibold")}>{d.getUTCDate()}/{d.getUTCMonth() + 1}</th>)}</tr></thead>
              <tbody>
                {typeGrid.map(({ t, cells, total }) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap"><Link href={`/reservations/new`} className="hover:underline">{t.name}</Link> <span className="text-xs text-ink-3">({total})</span></td>
                    {cells.map((c, i) => <td key={i} className={cn("px-1 py-2 text-center tabular-nums", c === 0 ? "bg-danger-soft text-danger" : c <= Math.ceil(total / 4) ? "bg-warn-soft text-warn" : "text-ink-2")}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
