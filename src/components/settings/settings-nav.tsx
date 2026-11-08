"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [["/settings", "Hotel"], ["/settings/users", "Users"], ["/settings/roles", "Roles & permissions"], ["/settings/sessions", "Sessions"], ["/settings/audit", "Audit log"]];
export function SettingsNav() {
  const p = usePathname();
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {ITEMS.map(([href, label]) => {
        const active = href === "/settings" ? p === href : p.startsWith(href);
        return <Link key={href} href={href} className={cn("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap", active ? "border-brand font-medium" : "border-transparent text-ink-3 hover:text-ink")}>{label}</Link>;
      })}
    </div>
  );
}
