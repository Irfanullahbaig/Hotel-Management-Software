import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AddAmenity, AddRateDialog, RoomTypeDialog, ToggleRate } from "@/components/rooms/type-forms";

export const metadata = { title: "Room types & rates" };
export const dynamic = "force-dynamic";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function TypesPage() {
  const ctx = await pageAuth("rooms.edit");
  if (!ctx) return <Forbidden />;
  const [types, amenities] = await Promise.all([
    prisma.roomType.findMany({ where: { propertyId: ctx.property.id }, include: { rates: { orderBy: [{ isActive: "desc" }, { priority: "desc" }] }, amenities: true, _count: { select: { rooms: true } } }, orderBy: { basePrice: "asc" } }),
    prisma.amenity.findMany({ where: { propertyId: ctx.property.id }, orderBy: { name: "asc" } }),
  ]);
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  return (
    <>
      <PageHeader back={{ href: "/rooms", label: "Rooms" }} title="Room types & rates" description="Categories, occupancy rules, base prices, and seasonal, weekend and holiday pricing." actions={<RoomTypeDialog amenities={amenities} />} />
      <div className="space-y-4">
        {types.map((t) => (
          <Card key={t.id}>
            <CardHeader
              title={<span className="flex items-center gap-2">{t.name} <Badge>{t.code}</Badge>{!t.isActive && <Badge tone="danger">Inactive</Badge>}</span>}
              description={`${t._count.rooms} rooms · ${money(t.basePrice)} base · ${t.baseOccupancy} included, max ${t.maxOccupancy} (${t.maxAdults} adults, ${t.maxChildren} children) · extra adult ${money(t.extraAdultCharge)}, child ${money(t.extraChildCharge)}`}
              actions={<><AddRateDialog roomTypeId={t.id} name={t.name} /><RoomTypeDialog amenities={amenities} type={{ id: t.id, code: t.code, name: t.name, description: t.description, baseOccupancy: t.baseOccupancy, maxOccupancy: t.maxOccupancy, maxAdults: t.maxAdults, maxChildren: t.maxChildren, bedConfiguration: t.bedConfiguration, isActive: t.isActive, sizeSqm: t.sizeSqm?.toString() ?? null, basePrice: t.basePrice.toString(), extraAdultCharge: t.extraAdultCharge.toString(), extraChildCharge: t.extraChildCharge.toString(), amenityIds: t.amenities.map((a) => a.amenityId) }} /></>}
            />
            {t.rates.length ? (
              <Table>
                <THead><tr><TH>Rate</TH><TH>Kind</TH><TH>Dates</TH><TH>Days</TH><TH className="text-right">Price</TH><TH className="text-right">Priority</TH><TH /></tr></THead>
                <TBody>
                  {t.rates.map((r) => (
                    <TR key={r.id} className={r.isActive ? "" : "opacity-50"}>
                      <TD>{r.name}</TD><TD className="capitalize">{r.kind.toLowerCase()}</TD>
                      <TD>{r.startDate || r.endDate ? `${formatDate(r.startDate)} → ${formatDate(r.endDate)}` : "Any"}</TD>
                      <TD>{r.daysOfWeek.length ? r.daysOfWeek.map((d) => DAYS[d]).join(", ") : "All"}</TD>
                      <TD className="text-right tabular-nums">{money(r.price)}</TD><TD className="text-right">{r.priority}</TD>
                      <TD className="text-right"><ToggleRate id={r.id} active={r.isActive} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : <CardBody className="text-xs text-ink-3">No special rates. The base price applies every night.</CardBody>}
          </Card>
        ))}
        <Card>
          <CardHeader title="Amenities" description="Available to tick on any room type" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-1.5">{amenities.map((a) => <Badge key={a.id}>{a.name}</Badge>)}</div>
            <AddAmenity />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
