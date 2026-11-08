import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { GuestForm } from "@/components/guests/guest-form";

export const metadata = { title: "Edit guest" };
export default async function EditGuest({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("guests.edit");
  if (!ctx) return <Forbidden />;
  const g = await prisma.guest.findFirst({ where: { id: (await params).id, propertyId: ctx.property.id } });
  if (!g) notFound();
  const { createdAt: _c, updatedAt: _u, propertyId: _p, isDemo: _d, ...rest } = g;
  return (<><PageHeader back={{ href: `/guests/${g.id}`, label: `${g.firstName} ${g.lastName}` }} title="Edit guest" /><Card><CardBody><GuestForm guest={{ ...rest, dateOfBirth: g.dateOfBirth ? toDateOnlyString(g.dateOfBirth) : null }} /></CardBody></Card></>);
}
