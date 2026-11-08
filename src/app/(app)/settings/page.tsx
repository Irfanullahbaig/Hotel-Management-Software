import { prisma } from "@/lib/db";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewPropertyDialog, PropertyForm } from "@/components/settings/forms";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await pageAuth("settings.view");
  if (!ctx) return <Forbidden />;
  const p = await prisma.property.findUniqueOrThrow({ where: { id: ctx.property.id } });
  const props = await prisma.property.findMany({ where: { organizationId: ctx.user.organizationId }, include: { _count: { select: { rooms: true } } }, orderBy: { name: "asc" } });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`${p.name} settings`} description="General and operational settings for the active property" />
        <CardBody>
          <PropertyForm readOnly={!ctx.can("settings.edit")} p={{ ...p, taxRate: p.taxRate.toString(), serviceChargeRate: p.serviceChargeRate.toString(), depositPercent: p.depositPercent.toString() }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Properties" description="Hotels in this organisation" actions={ctx.user.isSuperAdmin ? <NewPropertyDialog /> : undefined} />
        <CardBody className="space-y-2">
          {props.filter((x) => ctx.user.isSuperAdmin || ctx.properties.some((cp) => cp.id === x.id)).map((x) => (
            <div key={x.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="font-medium">{x.name} <Badge>{x.code}</Badge></span>
              <span className="text-xs text-ink-3">{x._count.rooms} rooms · {x.currency} · {x.timeZone}{x.id === ctx.property.id ? " · active" : ""}</span>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Integrations" description="Not connected. Nothing is sent or synchronised until real credentials are configured." />
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          {[["Email (booking confirmations)", process.env.EMAIL_PROVIDER], ["SMS", process.env.SMS_PROVIDER], ["WhatsApp Business API", undefined], ["Payment gateway", undefined], ["Channel manager / OTAs", undefined]].map(([k, v]) => (
            <div key={k as string} className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span>{k}</span><Badge tone={v ? "ok" : "neutral"}>{v ? "Configured" : "Not configured"}</Badge></div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
