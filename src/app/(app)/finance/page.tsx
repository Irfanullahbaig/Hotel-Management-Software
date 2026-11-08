import { prisma } from "@/lib/db";
import { D, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageAuth("finance.view");
  if (!ctx) return <Forbidden />;
  const tab = (await searchParams).tab ?? "trial";
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const rows = await prisma.$queryRaw<{ code: string; name: string; type: string; debit: string; credit: string }[]>`
    SELECT a.code, a.name, a.type::text, COALESCE(SUM(l.debit),0)::text AS debit, COALESCE(SUM(l.credit),0)::text AS credit
    FROM "Account" a LEFT JOIN "JournalLine" l ON l."accountId" = a.id
    WHERE a."propertyId" = ${ctx.property.id} GROUP BY a.code, a.name, a.type ORDER BY a.code`;
  const bal = (code: string) => { const r = rows.find((x) => x.code === code); return r ? D(r.debit).minus(r.credit) : D(0); };
  const totalDr = rows.reduce((a, r) => a.plus(D(r.debit).minus(r.credit).greaterThan(0) ? D(r.debit).minus(r.credit) : 0), D(0));
  const totalCr = rows.reduce((a, r) => a.plus(D(r.credit).minus(r.debit).greaterThan(0) ? D(r.credit).minus(r.debit) : 0), D(0));
  const revenue = rows.filter((r) => r.type === "INCOME").reduce((a, r) => a.plus(D(r.credit).minus(r.debit)), D(0));
  const expenses = rows.filter((r) => r.type === "EXPENSE").reduce((a, r) => a.plus(D(r.debit).minus(r.credit)), D(0));
  const entries = tab === "journal" ? await prisma.journalEntry.findMany({ where: { propertyId: ctx.property.id }, include: { lines: { include: { account: true } } }, orderBy: { postedAt: "desc" }, take: 100 }) : [];
  return (
    <>
      <PageHeader title="Finance & accounting" description="Every figure below is computed from posted journal entries. Full accounting tools (manual journals, expenses, payables, statements, period close) arrive in Phase 3." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total revenue" value={money(revenue)} />
        <Stat label="Total expenses" value={money(expenses)} />
        <Stat label="Net profit" value={money(revenue.minus(expenses))} tone={revenue.minus(expenses).isNegative() ? "danger" : "ok"} />
        <Stat label="Cash + bank" value={money(bal("1000").plus(bal("1010")))} />
        <Stat label="Accounts receivable" value={money(bal("1100"))} />
        <Stat label="Guest deposits held" value={money(bal("2100").negated())} />
        <Stat label="Taxes payable" value={money(bal("2200").negated())} />
      </div>
      <Tabs active={tab} items={[{ key: "trial", label: "Trial balance", href: "/finance?tab=trial" }, { key: "journal", label: "Journal entries", href: "/finance?tab=journal" }]} />
      {tab === "trial" ? (
        <Card>
          <CardHeader title="Trial balance" description="All time" actions={totalDr.equals(totalCr) ? <Badge tone="ok">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>} />
          <Table>
            <THead><tr><TH>Code</TH><TH>Account</TH><TH>Type</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
            <TBody>
              {rows.map((r) => { const net = D(r.debit).minus(r.credit); return (
                <TR key={r.code} className={net.isZero() ? "text-ink-3" : ""}><TD className="font-mono text-xs">{r.code}</TD><TD>{r.name}</TD><TD className="text-xs capitalize">{r.type.toLowerCase()}</TD><TD className="text-right tabular-nums">{net.greaterThan(0) ? money(net) : ""}</TD><TD className="text-right tabular-nums">{net.lessThan(0) ? money(net.negated()) : ""}</TD></TR>
              ); })}
              <TR className="bg-muted/50 font-semibold"><TD /><TD>Total</TD><TD /><TD className="text-right tabular-nums">{money(totalDr)}</TD><TD className="text-right tabular-nums">{money(totalCr)}</TD></TR>
            </TBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Journal entries" description="Latest 100. Posted entries are immutable; corrections are reversals." />
          <Table>
            <THead><tr><TH>Entry</TH><TH>Date</TH><TH>Memo</TH><TH>Source</TH><TH>Account</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
            <TBody>
              {entries.flatMap((e) => e.lines.map((l, i) => (
                <TR key={l.id} className={i === 0 ? "border-t-2 border-border" : ""}>
                  <TD className="font-mono text-xs">{i === 0 ? e.number : ""}</TD><TD className="text-xs whitespace-nowrap">{i === 0 ? formatDate(e.date) : ""}</TD><TD className="max-w-xs text-xs">{i === 0 ? e.memo : ""}</TD><TD className="text-xs text-ink-3">{i === 0 ? e.sourceType.toLowerCase() : ""}</TD>
                  <TD className="text-xs"><span className="font-mono">{l.account.code}</span> {l.account.name}</TD>
                  <TD className="text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</TD><TD className="text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</TD>
                </TR>
              )))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
