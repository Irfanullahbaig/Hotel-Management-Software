import Link from "next/link";
import { parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pageAuth } from "@/server/auth/page";
import { REPORTS, buildReport } from "@/server/services/reports";
import { EmptyState, Forbidden, PageHeader } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PrintButton } from "@/components/ui/print-button";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const safe = (v: string | undefined, f: Date) => { try { return v ? parseDateOnly(v) : f; } catch { return f; } };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string; asOf?: string }> }) {
  const ctx = await pageAuth("reports.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const allowed = Object.entries(REPORTS).filter(([, m]) => ctx.can(m.perm));
  const key = sp.r && REPORTS[sp.r] && ctx.can(REPORTS[sp.r].perm) ? sp.r : allowed[0]?.[0];
  const meta = key ? REPORTS[key] : null;
  const monthStart = new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), 1));
  const p = { from: safe(sp.from, monthStart), to: safe(sp.to, ctx.today), asOf: safe(sp.asOf, ctx.today) };
  if (p.to < p.from) p.to = p.from;
  const report = key ? await buildReport(key, ctx.property.id, p) : null;
  const money = (v: number) => formatMoney(v, ctx.property.currency);
  const fmt = (v: string | number, kind?: string) => (v === "" ? "" : kind === "money" ? money(Number(v)) : kind === "pct" ? `${v}%` : kind === "number" ? Number(v).toLocaleString() : v);
  const canExport = ctx.can("reports.export") || (meta && ctx.can(meta.perm.replace(".view", ".export")));
  const qs = meta?.range === "range" ? `from=${toDateOnlyString(p.from)}&to=${toDateOnlyString(p.to)}` : `asOf=${toDateOnlyString(p.asOf)}`;
  const groups = [...new Set(allowed.map(([, m]) => m.group))];

  return (
    <>
      <PageHeader title="Reports" description="Operational and financial reports, computed live from the same records the hotel runs on." actions={<PrintButton />} />
      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav className="space-y-4 print:hidden">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{g}</div>
              {allowed.filter(([, m]) => m.group === g).map(([k, m]) => (
                <Link key={k} href={`/reports?r=${k}`} className={cn("block rounded-md px-2 py-1.5 text-sm hover:bg-muted", k === key && "bg-brand-soft font-medium text-brand")}>{m.label}</Link>
              ))}
            </div>
          ))}
        </nav>
        <div>
          {meta && (
            <form method="get" className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
              <input type="hidden" name="r" value={key} />
              {meta.range === "range" && (
                <>
                  <label className="text-xs text-ink-3">From<Input type="date" name="from" defaultValue={toDateOnlyString(p.from)} className="w-40" /></label>
                  <label className="text-xs text-ink-3">To<Input type="date" name="to" defaultValue={toDateOnlyString(p.to)} className="w-40" /></label>
                </>
              )}
              {meta.range === "asOf" && <label className="text-xs text-ink-3">As of<Input type="date" name="asOf" defaultValue={toDateOnlyString(p.asOf)} className="w-40" /></label>}
              {meta.range !== "none" && <Button type="submit" variant="secondary" size="sm">Run</Button>}
              {canExport && <LinkButton href={`/api/reports/${key}?${qs}`} variant="ghost" size="sm">Export CSV</LinkButton>}
            </form>
          )}
          <Card>
            {!report ? <EmptyState title="No reports available to you" /> : (
              <>
                <CardHeader title={report.title} description={[meta?.range === "range" ? `${toDateOnlyString(p.from)} → ${toDateOnlyString(p.to)}` : "", report.description].filter(Boolean).join(" · ")} />
                {report.rows.length === 0 ? <EmptyState title="No data for this period" /> : (
                  <div className="overflow-x-auto">
                    <Table>
                      <THead><tr>{report.columns.map((c) => <TH key={c.label} className={c.kind && c.kind !== "text" ? "text-right" : ""}>{c.label}</TH>)}</tr></THead>
                      <TBody>
                        {report.rows.map((row, i) => (
                          <TR key={i} className={String(row[2] ?? row[1] ?? "").startsWith("Total") ? "font-semibold" : ""}>
                            {row.map((v, j) => <TD key={j} className={cn("text-sm", report.columns[j]?.kind && report.columns[j].kind !== "text" && "text-right tabular-nums")}>{fmt(v, report.columns[j]?.kind)}</TD>)}
                          </TR>
                        ))}
                        {report.total && <TR className="border-t-2 border-border bg-muted/50 font-semibold">{report.total.map((v, j) => <TD key={j} className={cn(report.columns[j]?.kind && report.columns[j].kind !== "text" && "text-right tabular-nums")}>{fmt(v, report.columns[j]?.kind)}</TD>)}</TR>}
                      </TBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
