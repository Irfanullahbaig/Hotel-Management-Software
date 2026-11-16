import { prisma } from "@/lib/db";
import { toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { manualJournalAction } from "@/server/actions/finance";
import { Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardBody } from "@/components/ui/card";
import { LinesForm } from "@/components/ui/quick-form";

export const metadata = { title: "Manual journal" };

export default async function NewJournalPage() {
  const ctx = await pageAuth("finance.create");
  if (!ctx) return <Forbidden />;
  const accounts = await prisma.account.findMany({ where: { propertyId: ctx.property.id, isActive: true }, orderBy: { code: "asc" } });
  return (
    <>
      <PageHeader title="Manual journal entry" description="For opening balances, accruals, depreciation and corrections. Total debits must equal total credits. Posted entries cannot be edited, only reversed." back={{ href: "/finance?tab=journal", label: "Journal" }} />
      <Card>
        <CardBody>
          <LinesForm
            action={manualJournalAction} submitLabel="Post entry" initialRows={2}
            fields={[
              { name: "date", label: "Date", type: "date", required: true, defaultValue: toDateOnlyString(ctx.today), span: 1 },
              { name: "memo", label: "Memo", required: true, span: 3, placeholder: "e.g. Opening bank balance" },
            ]}
            columns={[
              { name: "account", label: "Account", type: "select", options: accounts.map((a) => [a.code, `${a.code} ${a.name}`]) },
              { name: "debit", label: "Debit", type: "number", width: "9rem" },
              { name: "credit", label: "Credit", type: "number", width: "9rem" },
              { name: "lineMemo", label: "Line note", type: "text", width: "14rem" },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}
