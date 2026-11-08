import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Inventory" };

export default async function Page() {
  if (!(await pageAuth("inventory.view"))) return <Forbidden />;
  return <ComingSoon title="Inventory" phase={4} items={['Products, SKUs and units', 'Stock in/out, transfers and adjustments', 'Multiple stores and batches', 'Low-stock and expiry alerts', 'Inventory valuation in the ledger']} />;
}
