import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Restaurant & POS" };

export default async function Page() {
  if (!(await pageAuth("restaurant.view"))) return <Forbidden />;
  return <ComingSoon title="Restaurant & POS" phase={2} items={['Restaurants, dining areas and tables', 'Menus, categories and items', 'POS orders, split and merged bills', 'Kitchen display and tickets', 'Charges posted to guest folios', 'Recipe-based stock deduction']} />;
}
