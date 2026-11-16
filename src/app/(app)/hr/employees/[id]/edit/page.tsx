import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { employeeFormOptions } from "@/server/services/hr-options";
import { employeeName } from "@/server/services/hr";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { EmployeeForm } from "@/components/hr/forms";

export const metadata = { title: "Edit employee" };
export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("hr.edit");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const e = await prisma.employee.findFirst({ where: { id, propertyId: ctx.property.id } });
  if (!e) notFound();
  const sensitive = ctx.can("hr.view_sensitive");
  const opts = await employeeFormOptions(ctx.property.id, e.id);
  const d = (v: Date | null) => (v ? toDateOnlyString(v) : null);
  return (
    <>
      <PageHeader back={{ href: `/hr/employees/${e.id}`, label: employeeName(e) }} title={`Edit ${employeeName(e)}`} description={e.employeeNo} />
      <Card><CardBody>
        <EmployeeForm
          {...opts} sensitive={sensitive} currency={ctx.property.currency} today={toDateOnlyString(ctx.today)}
          employee={{
            ...e, hireDate: toDateOnlyString(e.hireDate), dateOfBirth: d(e.dateOfBirth), employmentType: e.employmentType,
            baseSalary: sensitive ? e.baseSalary.toString() : undefined,
            nationalId: sensitive ? e.nationalId : null, bankName: sensitive ? e.bankName : null, bankAccount: sensitive ? e.bankAccount : null,
          }}
        />
      </CardBody></Card>
    </>
  );
}
