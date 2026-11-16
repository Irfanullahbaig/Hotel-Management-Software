import { notFound } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";
import { SWITCHABLE_MODULES, isModuleEnabled, type SwitchableModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

export default async function PendingModulePage({ params }: { params: Promise<{ module: string }> }) {
  const key = (await params).module as SwitchableModule;
  const m = SWITCHABLE_MODULES[key];
  if (!m || isModuleEnabled(key)) notFound();
  return (
    <>
      <PageHeader title={m.label} description="Pending" />
      <Card><CardBody>
        <p className="text-sm text-ink-2">This module is pending and not switched on for this hotel yet. Front desk, rooms, reservations, guests, housekeeping and Staff &amp; HR are live.</p>
      </CardBody></Card>
    </>
  );
}
