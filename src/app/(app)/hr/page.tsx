import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Staff & HR" };

export default async function Page() {
  if (!(await pageAuth("hr.view"))) return <Forbidden />;
  return <ComingSoon title="Staff & HR" phase={4} items={['Employee profiles and documents', 'Attendance, shifts and overtime', 'Leave policies and approvals', 'Payroll with ledger postings', 'Performance and training records']} />;
}
