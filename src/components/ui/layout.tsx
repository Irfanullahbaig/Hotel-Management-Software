import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
            <ChevronLeft className="size-3.5" /> {back.label}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-ink-3">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-ink-2 hover:bg-muted";
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-ink-3">
      <span>{total === 0 ? "No results" : `${from}–${to} of ${total}`}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link aria-label="Previous page" className={btn} href={hrefFor(page - 1)}><ChevronLeft className="size-4" /></Link> : <span className={cn(btn, "opacity-40")}><ChevronLeft className="size-4" /></span>}
        <span className="px-2">Page {page} of {pages}</span>
        {page < pages ? <Link aria-label="Next page" className={btn} href={hrefFor(page + 1)}><ChevronRight className="size-4" /></Link> : <span className={cn(btn, "opacity-40")}><ChevronRight className="size-4" /></span>}
      </div>
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap", t.key === active ? "border-brand font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] text-ink-2">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-ink-3">Ask an administrator to grant your role the permission you need.</p>
    </div>
  );
}
