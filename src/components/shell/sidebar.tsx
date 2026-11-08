"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav";

export function Sidebar({ items, propertyName }: { items: NavItem[]; propertyName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Main">
      {items.map((item) => {
        const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Circle;
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
              active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-muted hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.phase && <span className="ml-auto rounded bg-muted px-1.5 text-[10px] text-ink-3">P{item.phase}</span>}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <button className="fixed top-3 left-3 z-40 rounded-md border border-border bg-surface p-1.5 lg:hidden no-print" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
        <Icons.Menu className="size-5" />
      </button>
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-60 overflow-y-auto border-r border-border bg-surface transition-transform lg:translate-x-0 no-print", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-brand text-white"><Icons.BedDouble className="size-4" /></div>
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-semibold">HMS</div>
            <div className="truncate text-[11px] text-ink-3">{propertyName}</div>
          </div>
        </div>
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/20 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
