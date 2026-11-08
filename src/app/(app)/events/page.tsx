import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Events" };

export default async function Page() {
  if (!(await pageAuth("events.view"))) return <Forbidden />;
  return <ComingSoon title="Events" phase={5} items={['Halls and meeting rooms', 'Event bookings, packages and catering', 'Quotations, deposits and invoices', 'Event profitability']} />;
}
