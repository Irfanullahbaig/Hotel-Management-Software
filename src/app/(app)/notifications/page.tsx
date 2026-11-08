import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { titleCase } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MarkAllRead } from "@/components/settings/forms";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const ctx = await pageAuth("notifications.view");
  if (!ctx) return <Forbidden />;
  const items = await prisma.notification.findMany({ where: { propertyId: ctx.property.id, OR: [{ userId: null }, { userId: ctx.user.id }] }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="Notifications" description="In-app alerts, plus a log of outgoing email/SMS messages and their delivery status." actions={<MarkAllRead />} />
      <Card>
        {items.length === 0 ? <EmptyState title="No notifications" /> : (
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.readAt || n.channel !== "IN_APP" ? "" : "bg-brand-soft/40"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                    <Badge>{titleCase(n.type)}</Badge>
                    {n.channel !== "IN_APP" && <Badge tone={n.delivery === "NOT_CONFIGURED" ? "warn" : n.delivery === "FAILED" ? "danger" : "ok"}>{n.channel.toLowerCase()} · {n.delivery === "NOT_CONFIGURED" ? "not sent: provider not configured" : n.delivery.toLowerCase()}</Badge>}
                  </div>
                  {n.body && <p className="text-sm text-ink-2">{n.body}</p>}
                </div>
                <span className="shrink-0 text-xs text-ink-3">{formatDateTime(n.createdAt, ctx.property.timeZone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
