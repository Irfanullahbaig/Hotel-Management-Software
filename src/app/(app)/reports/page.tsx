import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Reports" };

export default async function Page() {
  if (!(await pageAuth("reports.view"))) return <Forbidden />;
  return <ComingSoon title="Reports" phase={3} items={['Reservation, occupancy and no-show reports', 'Financial statements from the ledger', 'HR and operational reports', 'PDF, Excel, CSV export and print']} />;
}
