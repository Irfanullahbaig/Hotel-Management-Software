import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Services" };

export default async function Page() {
  if (!(await pageAuth("services.view"))) return <Forbidden />;
  return <ComingSoon title="Services" phase={2} items={['Laundry, spa, transfers, tours and more', 'Service pricing, tax and availability', 'Post service charges to room folios']} />;
}
