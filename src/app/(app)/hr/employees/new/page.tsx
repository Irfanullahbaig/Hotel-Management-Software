import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { employeeFormOptions } from "@/server/services/hr-options";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { EmployeeForm } from "@/components/hr/forms";

export const metadata = { title: "New employee" };
export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  const ctx = await pageAuth("hr.create");
  if (!ctx) return <Forbidden />;
  const opts = await employeeFormOptions(ctx.property.id);
  return (
    <>
      <PageHeader back={{ href: "/hr", label: "Staff & HR" }} title="New employee" description="An employee number is assigned automatically." />
      <Card><CardBody><EmployeeForm {...opts} sensitive={ctx.can("hr.view_sensitive")} currency={ctx.property.currency} today={toDateOnlyString(ctx.today)} /></CardBody></Card>
    </>
  );
}
