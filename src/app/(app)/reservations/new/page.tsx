import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { createReservationAction } from "@/server/actions/reservations";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { BookingForm } from "@/components/reservations/booking-form";

export const metadata = { title: "New reservation" };

export default async function NewReservationPage() {
  const ctx = await pageAuth("reservations.create");
  if (!ctx) return <Forbidden />;
  return (
    <>
      <PageHeader back={{ href: "/reservations", label: "Reservations" }} title="New reservation" description="Availability and price update as you type. Rooms are held the moment the reservation is saved." />
      <BookingForm mode="reservation" action={createReservationAction} today={toDateOnlyString(ctx.today)} currency={ctx.property.currency} canDiscount={ctx.can("reservations.override_rate")} canPay={ctx.can("frontdesk.payment")} />
    </>
  );
}
