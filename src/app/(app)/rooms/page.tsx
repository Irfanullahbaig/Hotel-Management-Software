import Link from "next/link";
import { Plus, Settings2, User } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { cn, fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { displayStatus, type DisplayStatus } from "@/server/services/rooms";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { ROOM_STATUS_STYLE } from "@/components/rooms/status";

export const metadata = { title: "Rooms" };
export const dynamic = "force-dynamic";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; floor?: string }> }) {
  const ctx = await pageAuth("rooms.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const [rooms, types] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: ctx.property.id, isActive: true, roomTypeId: sp.type || undefined, floor: sp.floor ? Number(sp.floor) : undefined },
      include: {
        roomType: true,
        reservationRooms: {
          where: { OR: [{ status: "CHECKED_IN" }, { status: "RESERVED", checkIn: ctx.today }] },
          include: { reservation: { include: { guest: true } } },
        },
      },
      orderBy: [{ floor: "asc" }, { number: "asc" }],
    }),
    prisma.roomType.findMany({ where: { propertyId: ctx.property.id }, orderBy: { name: "asc" } }),
  ]);
  const enriched = rooms.map((r) => {
    const stay = r.reservationRooms.find((l) => l.status === "CHECKED_IN") ?? r.reservationRooms[0];
    return { ...r, stay, display: displayStatus(r, r.reservationRooms.some((l) => l.status === "RESERVED")) };
  });
  const counts = enriched.reduce<Record<string, number>>((a, r) => ((a[r.display] = (a[r.display] ?? 0) + 1), a), {});
  const shown = sp.status ? enriched.filter((r) => r.display === sp.status) : enriched;
  const floors = [...new Set(shown.map((r) => r.floor))];
  const allFloors = [...new Set(rooms.map((r) => r.floor))];

  return (
    <>
      <PageHeader
        title="Rooms"
        description="Live room status board. Click a room for details and actions."
        actions={
          <>
            {ctx.can("rooms.edit") && <LinkButton href="/rooms/types" variant="secondary"><Settings2 className="size-4" /> Room types & rates</LinkButton>}
            {ctx.can("rooms.create") && <LinkButton href="/rooms/new"><Plus className="size-4" /> Add rooms</LinkButton>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/rooms" className={cn("rounded-full border px-2.5 py-1 text-xs", !sp.status ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-ink-2 hover:bg-muted")}>All {enriched.length}</Link>
        {(Object.keys(ROOM_STATUS_STYLE) as DisplayStatus[]).filter((s) => counts[s]).map((s) => (
          <Link key={s} href={`/rooms?status=${s}${sp.type ? `&type=${sp.type}` : ""}`} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", sp.status === s ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-ink-2 hover:bg-muted")}>
            <span className={cn("size-2 rounded-full", ROOM_STATUS_STYLE[s].dot)} />
            {ROOM_STATUS_STYLE[s].label} {counts[s]}
          </Link>
        ))}
        <form className="ml-auto flex gap-2" method="get">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <Select name="type" defaultValue={sp.type ?? ""} className="w-44" aria-label="Room type">
            <option value="">All room types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="floor" defaultValue={sp.floor ?? ""} className="w-32" aria-label="Floor">
            <option value="">All floors</option>
            {allFloors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
          </Select>
          <button className="h-9 rounded-md border border-border bg-surface px-3 text-sm hover:bg-muted">Filter</button>
        </form>
      </div>
      {shown.length === 0 && <Card className="p-8 text-center text-sm text-ink-3">No rooms match these filters.</Card>}
      <div className="space-y-5">
        {floors.map((floor) => (
          <section key={floor}>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Floor {floor}</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
              {shown.filter((r) => r.floor === floor).map((r) => {
                const st = ROOM_STATUS_STYLE[r.display];
                return (
                  <Link key={r.id} href={`/rooms/${r.id}`} className={cn("group rounded-lg border p-3 transition-shadow hover:shadow-md focus-visible:shadow-md", st.tile)}>
                    <div className="flex items-start justify-between">
                      <span className="text-base font-semibold tabular-nums">{r.number}</span>
                      <span className={cn("mt-1.5 size-2 rounded-full", st.dot)} title={st.label} />
                    </div>
                    <div className="truncate text-xs text-ink-2">{r.roomType.name}</div>
                    <div className="mt-2 text-[11px] font-medium text-ink-2">{st.label}</div>
                    {r.stay && (
                      <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-ink-3">
                        <User className="size-3 shrink-0" />
                        <span className="truncate">{fullName(r.stay.reservation.guest)}</span>
                        <span className="shrink-0">· until {formatDate(r.stay.checkOut).slice(0, 6)}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
