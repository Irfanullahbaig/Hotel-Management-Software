import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Procurement" };

export default async function Page() {
  if (!(await pageAuth("procurement.view"))) return <Forbidden />;
  return <ComingSoon title="Procurement" phase={4} items={['Suppliers', 'Purchase requests and approvals', 'Purchase orders and goods received', 'Supplier invoices and payments']} />;
}
