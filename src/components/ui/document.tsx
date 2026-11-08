export function DocumentShell({ property, title, number, children }: { property: { name: string; address: string | null; phone: string | null; email: string | null }; title: string; number: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-border bg-white p-8 shadow-[var(--shadow-card)] print:border-0 print:p-0 print:shadow-none">
      <div className="flex items-start justify-between border-b border-border pb-5">
        <div>
          <div className="text-lg font-semibold text-brand">{property.name}</div>
          <div className="mt-1 text-xs leading-relaxed text-ink-3">{[property.address, property.phone, property.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="text-xs tracking-wider text-ink-3 uppercase">{title}</div>
          <div className="text-base font-semibold">{number}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
