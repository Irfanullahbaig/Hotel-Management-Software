import { prisma } from "@/lib/db";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BulkRoomForm, RoomForm } from "@/components/rooms/room-form";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Add rooms" };

export default async function NewRoomPage() {
  const ctx = await pageAuth("rooms.create");
  if (!ctx) return <Forbidden />;
  const types = (await prisma.roomType.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { name: "asc" } })).map((t) => ({ id: t.id, name: t.name }));
  if (!types.length) {
    return (<><PageHeader back={{ href: "/rooms", label: "Rooms" }} title="Add rooms" /><Card><CardBody>Create a room type first. <LinkButton href="/rooms/types" variant="secondary" size="sm">Room types</LinkButton></CardBody></Card></>);
  }
  return (
    <>
      <PageHeader back={{ href: "/rooms", label: "Rooms" }} title="Add rooms" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Single room" /><CardBody><RoomForm types={types} /></CardBody></Card>
        <Card><CardHeader title="Bulk create" description="Create a numbered range of rooms on one floor" /><CardBody><BulkRoomForm types={types} /></CardBody></Card>
      </div>
    </>
  );
}
