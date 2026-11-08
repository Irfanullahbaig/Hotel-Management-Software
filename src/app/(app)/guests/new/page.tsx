import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { GuestForm } from "@/components/guests/guest-form";

export const metadata = { title: "New guest" };
export default async function NewGuest() {
  const ctx = await pageAuth("guests.create");
  if (!ctx) return <Forbidden />;
  return (<><PageHeader back={{ href: "/guests", label: "Guests" }} title="New guest" /><Card><CardBody><GuestForm /></CardBody></Card></>);
}
