import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Sales & Marketing" };

export default async function Page() {
  if (!(await pageAuth("sales.view"))) return <Forbidden />;
  return <ComingSoon title="Sales & Marketing" phase={5} items={['Corporate, group and promotional rates', 'Coupons and packages', 'Revenue forecasting and channel analysis', 'Loyalty programme and campaigns']} />;
}
