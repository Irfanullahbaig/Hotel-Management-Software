import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { walkInAction } from "@/server/actions/frontdesk";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { BookingForm } from "@/components/reservations/booking-form";

export const metadata = { title: "Walk-in" };

export default async function WalkInPage() {
  const ctx = await pageAuth("frontdesk.checkin");
  if (!ctx || !ctx.can("reservations.create")) return <Forbidden />;
  return (
    <>
      <PageHeader back={{ href: "/frontdesk", label: "Front desk" }} title="Walk-in check-in" description="Creates a same-day reservation and checks the guest in, in one step." />
      <BookingForm mode="walkin" action={walkInAction} today={toDateOnlyString(ctx.today)} currency={ctx.property.currency} canDiscount={ctx.can("reservations.override_rate")} canPay={ctx.can("frontdesk.payment")} />
    </>
  );
}
