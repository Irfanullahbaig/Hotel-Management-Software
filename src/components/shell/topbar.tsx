import Link from "next/link";
import { Bell, LogOut, UserRound } from "lucide-react";
import { logoutAction, switchPropertyAction } from "@/server/actions/auth";

export function Topbar({ user, roles, properties, propertyId, unread }: { user: { name: string; email: string }; roles: string[]; properties: { id: string; name: string }[]; propertyId: string | null; unread: number }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 pl-14 backdrop-blur lg:pl-6 no-print">
      {properties.length > 1 ? (
        <form action={switchPropertyAction} className="flex items-center gap-2">
          <label htmlFor="prop" className="sr-only">Property</label>
          <select id="prop" name="propertyId" defaultValue={propertyId ?? ""} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="h-8 rounded-md border border-border px-2 text-xs text-ink-2 hover:bg-muted">Switch</button>
        </form>
      ) : (
        <span className="text-sm font-medium text-ink-2">{properties[0]?.name}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Link href="/notifications" className="relative rounded-md p-2 text-ink-2 hover:bg-muted" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <Link href="/account" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand"><UserRound className="size-4" /></span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-[13px] font-medium">{user.name}</span>
            <span className="block max-w-48 truncate text-[11px] text-ink-3">{roles.join(", ") || "No role"}</span>
          </span>
        </Link>
        <form action={logoutAction}>
          <button className="rounded-md p-2 text-ink-2 hover:bg-muted" aria-label="Sign out" title="Sign out"><LogOut className="size-4" /></button>
        </form>
      </div>
    </header>
  );
}
