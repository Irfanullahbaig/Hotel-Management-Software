import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { displayStatus } from "@/server/services/rooms";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RoomActions } from "@/components/rooms/room-actions";
import { RoomForm } from "@/components/rooms/room-form";
import { ROOM_STATUS_STYLE } from "@/components/rooms/status";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("rooms.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const room = await prisma.room.findFirst({
    where: { id, propertyId: ctx.property.id },
    include: {
      roomType: { include: { amenities: { include: { amenity: true } } } },
      statusLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      blocks: { where: { releasedAt: null, endDate: { gt: ctx.today } }, orderBy: { startDate: "asc" } },
      housekeeping: { orderBy: { createdAt: "desc" }, take: 5 },
      reservationRooms: { include: { reservation: { include: { guest: true } } }, orderBy: { checkIn: "desc" }, take: 25 },
    },
  });
  if (!room) notFound();
  const types = await prisma.roomType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { name: "asc" } });
  const current = room.reservationRooms.find((l) => l.status === "CHECKED_IN");
  const upcoming = room.reservationRooms.filter((l) => l.status === "RESERVED").reverse();
  const history = room.reservationRooms.filter((l) => !["RESERVED", "CHECKED_IN"].includes(l.status));
  const display = displayStatus(room, upcoming.some((u) => u.checkIn.getTime() === ctx.today.getTime()));
  const userIds = [...new Set(room.statusLogs.map((l) => l.userId).filter(Boolean))] as string[];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        back={{ href: "/rooms", label: "Rooms" }}
        title={<span className="flex items-center gap-3">Room {room.number}<Badge tone="neutral">{ROOM_STATUS_STYLE[display].label}</Badge></span>}
        description={`${room.roomType.name} · Floor ${room.floor}${room.building ? ` · ${room.building}` : ""}${room.name ? ` · ${room.name}` : ""}`}
        actions={ctx.can("rooms.change_status") ? <RoomActions roomId={room.id} hk={room.housekeepingStatus} service={room.serviceStatus} today={toDateOnlyString(ctx.today)} /> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Current guest" />
            <CardBody>
              {current ? (
                <DescriptionList items={[
                  ["Guest", <Link key="g" className="text-brand hover:underline" href={`/guests/${current.reservation.guestId}`}>{fullName(current.reservation.guest)}</Link>],
                  ["Reservation", <Link key="r" className="text-brand hover:underline" href={`/reservations/${current.reservationId}`}>{current.reservation.reference}</Link>],
                  ["Stay", `${formatDate(current.checkIn)} → ${formatDate(current.checkOut)}`],
                  ["Occupants", `${current.adults} adults, ${current.children} children`],
                  ["Checked in", formatDateTime(current.checkedInAt, ctx.property.timeZone)],
                  ["Special requests", current.reservation.specialRequests ?? "—"],
                ]} />
              ) : <p className="text-sm text-ink-3">Room is vacant.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Upcoming reservations" />
            {upcoming.length ? (
              <Table>
                <THead><tr><TH>Reference</TH><TH>Guest</TH><TH>Arrival</TH><TH>Departure</TH></tr></THead>
                <TBody>{upcoming.map((l) => (
                  <TR key={l.id}><TD><Link className="text-brand hover:underline" href={`/reservations/${l.reservationId}`}>{l.reservation.reference}</Link></TD><TD>{fullName(l.reservation.guest)}</TD><TD>{formatDate(l.checkIn)}</TD><TD>{formatDate(l.checkOut)}</TD></TR>
                ))}</TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No upcoming reservations assigned to this room.</CardBody>}
          </Card>
          <Card>
            <CardHeader title="Stay history" />
            {history.length ? (
              <Table>
                <THead><tr><TH>Reference</TH><TH>Guest</TH><TH>Dates</TH><TH>Status</TH></tr></THead>
                <TBody>{history.map((l) => (
                  <TR key={l.id}><TD><Link className="text-brand hover:underline" href={`/reservations/${l.reservationId}`}>{l.reservation.reference}</Link></TD><TD>{fullName(l.reservation.guest)}</TD><TD>{formatDate(l.checkIn)} → {formatDate(l.checkOut)}</TD><TD><StatusBadge status={l.status} /></TD></TR>
                ))}</TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No past stays.</CardBody>}
          </Card>
          <Card>
            <CardHeader title="Status history" description="Every change to occupancy, housekeeping and service status" />
            {room.statusLogs.length ? (
              <Table>
                <THead><tr><TH>When</TH><TH>Change</TH><TH>Reason</TH><TH>By</TH></tr></THead>
                <TBody>{room.statusLogs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-ink-2">{formatDateTime(l.createdAt, ctx.property.timeZone)}</TD>
                    <TD><span className="text-ink-3 capitalize">{l.field}:</span> {l.fromValue?.toLowerCase().replaceAll("_", " ")} → <strong className="font-medium">{l.toValue.toLowerCase().replaceAll("_", " ")}</strong></TD>
                    <TD className="text-ink-2">{l.reason}</TD>
                    <TD className="text-ink-2">{l.userId ? users.get(l.userId) : "System"}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            ) : <CardBody className="text-sm text-ink-3">No changes recorded yet.</CardBody>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Status" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-3">Occupancy</span><StatusBadge status={room.occupancyStatus} /></div>
              <div className="flex justify-between"><span className="text-ink-3">Housekeeping</span><StatusBadge status={room.housekeepingStatus} /></div>
              <div className="flex justify-between"><span className="text-ink-3">Service</span><StatusBadge status={room.serviceStatus} /></div>
              {room.blocks.map((b) => (
                <p key={b.id} className="rounded-md bg-muted p-2 text-xs text-ink-2">{b.kind.replaceAll("_", " ").toLowerCase()} {toDateOnlyString(b.startDate)} → {toDateOnlyString(b.endDate)}: {b.reason}</p>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Room type" />
            <CardBody>
              <DescriptionList className="sm:grid-cols-1" items={[
                ["Base price", formatMoney(room.roomType.basePrice, ctx.property.currency)],
                ["Occupancy", `${room.roomType.baseOccupancy} included, max ${room.roomType.maxOccupancy}`],
                ["Beds", room.roomType.bedConfiguration ?? "—"],
                ["Size", room.roomType.sizeSqm ? `${room.roomType.sizeSqm} m²` : "—"],
                ["Amenities", room.roomType.amenities.map((a) => a.amenity.name).join(", ") || "—"],
              ]} />
            </CardBody>
          </Card>
          {ctx.can("rooms.edit") && (
            <Card>
              <CardHeader title="Edit room" />
              <CardBody><RoomForm room={{ id: room.id, number: room.number, name: room.name, roomTypeId: room.roomTypeId, floor: room.floor, building: room.building, description: room.description, isActive: room.isActive }} types={types.map((t) => ({ id: t.id, name: t.name }))} /></CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
