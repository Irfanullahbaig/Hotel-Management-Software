import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { kitchenStatusAction } from "@/server/actions/pos";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PostButton } from "@/components/ui/quick-form";
import { AutoRefresh } from "@/components/ui/auto-refresh";

export const metadata = { title: "Kitchen display" };
export const dynamic = "force-dynamic";

const NEXT: Record<string, [string, string]> = { NEW: ["PREPARING", "Start"], PREPARING: ["READY", "Ready"], READY: ["SERVED", "Served"] };

export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const ctx = await pageAuth("restaurant.view");
  if (!ctx) return <Forbidden />;
  const station = (await searchParams).station === "BAR" ? "BAR" : "KITCHEN";
  const orders = await prisma.posOrder.findMany({
    where: { propertyId: ctx.property.id, status: "OPEN", items: { some: { station, status: { in: ["NEW", "PREPARING", "READY"] } } } },
    include: { table: true, outlet: true, items: { where: { station, status: { in: ["NEW", "PREPARING", "READY"] } }, orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "asc" },
  });
  const canEdit = ctx.can("restaurant.edit");
  const now = Date.now();
  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader title="Kitchen display" description="Tickets refresh every 10 seconds. Oldest first." back={{ href: "/restaurant", label: "Restaurant" }} />
      <Tabs active={station} items={[{ key: "KITCHEN", label: "Kitchen", href: "/restaurant/kitchen?station=KITCHEN" }, { key: "BAR", label: "Bar", href: "/restaurant/kitchen?station=BAR" }]} />
      {orders.length === 0 ? <Card><EmptyState title="No tickets" description="New orders appear here automatically." /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {orders.map((o) => {
            const oldest = Math.min(...o.items.map((i) => i.createdAt.getTime()));
            const mins = Math.floor((now - oldest) / 60000);
            return (
              <Card key={o.id} className={cn("overflow-hidden", mins >= 20 && "ring-2 ring-danger")}>
                <div className={cn("flex items-center justify-between px-3 py-2 text-sm font-semibold", mins >= 20 ? "bg-danger-soft text-danger" : mins >= 10 ? "bg-warn-soft text-warn" : "bg-muted")}>
                  <span>{o.table ? `Table ${o.table.name}` : o.kind === "ROOM_SERVICE" ? `Room ${o.roomNumber ?? ""}` : "Takeaway"}</span>
                  <span className="font-mono text-xs">{o.number} · {mins}m</span>
                </div>
                <ul className="divide-y divide-border">
                  {o.items.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-2 px-3 py-2">
                      <div>
                        <div className="font-medium"><span className="tabular-nums">{i.quantity}×</span> {i.name}</div>
                        {i.notes && <div className="text-xs font-medium text-warn">{i.notes}</div>}
                        <StatusBadge status={i.status} className="mt-1" />
                      </div>
                      {canEdit && NEXT[i.status] && <PostButton action={kitchenStatusAction} fields={{ itemId: i.id, status: NEXT[i.status][0] }} label={NEXT[i.status][1]} variant={i.status === "PREPARING" ? "primary" : "secondary"} />}
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border px-3 py-1.5 text-[11px] text-ink-3">{o.outlet.name}{o.guestName ? ` · ${o.guestName}` : ""}</div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
