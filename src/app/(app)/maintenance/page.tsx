import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata = { title: "Maintenance" };

export default async function Page() {
  if (!(await pageAuth("maintenance.view"))) return <Forbidden />;
  return <ComingSoon title="Maintenance" phase={2} items={['Maintenance requests and room issues', 'Technician assignment, priorities and deadlines', 'Repair notes, photos and costs', 'Preventive maintenance schedules', 'Equipment history', 'Automatic removal from room inventory (rooms can already be blocked from the Rooms page)']} />;
}
