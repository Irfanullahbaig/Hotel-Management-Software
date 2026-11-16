import { prisma } from "@/lib/db";
import { can, requireAuth } from "@/server/auth/context";
import { NAV } from "@/components/shell/nav";
import { pendingModuleFor } from "@/lib/modules";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const items = NAV.filter((n) => can(ctx, n.permission)).map((n) => ({ ...n, pending: !!pendingModuleFor(n.href) }));
  const unread = ctx.property
    ? await prisma.notification.count({ where: { propertyId: ctx.property.id, readAt: null, channel: "IN_APP", OR: [{ userId: null }, { userId: ctx.user.id }] } })
    : 0;
  return (
    <div className="min-h-screen">
      <Sidebar items={items} propertyName={ctx.property?.name ?? "No property"} />
      <div className="lg:pl-60">
        <Topbar user={ctx.user} roles={ctx.user.isSuperAdmin ? ["Super Admin", ...ctx.roles.filter((r) => r !== "Super Admin")] : ctx.roles} properties={ctx.properties} propertyId={ctx.property?.id ?? null} unread={unread} />
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">{ctx.property ? children : <p className="text-ink-3">Your account is not assigned to a property yet. Ask an administrator.</p>}</main>
      </div>
    </div>
  );
}
