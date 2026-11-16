import Link from "next/link";
import { prisma } from "@/lib/db";
import { D, formatMoney, sum } from "@/lib/money";
import { addDays, formatDate, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { balanceSheet, balancesByAccount, budgetVsActual, payablesAging, profitAndLoss, receivablesAging } from "@/server/services/accounting";
import { addAccountAction, closeBooksAction, payBillAction, recordExpenseAction, reopenBooksAction, reverseEntryAction, setBudgetAction } from "@/server/actions/finance";
import { EmptyState, Forbidden, PageHeader, Tabs } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormDialog, InlineForm, LinesForm, type Opt } from "@/components/ui/quick-form";

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

const PAY: Opt[] = [["CASH", "Cash"], ["BANK_TRANSFER", "Bank"], ["CARD", "Card"], ["CHEQUE", "Cheque"]];
type SP = { tab?: string; from?: string; to?: string; asOf?: string; year?: string };

function safeDate(v: string | undefined, fallback: Date) {
  try { return v ? parseDateOnly(v) : fallback; } catch { return fallback; }
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageAuth("finance.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const pid = ctx.property.id;
  const money = (v: unknown) => formatMoney(v as string, ctx.property.currency);
  const monthStart = new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), 1));
  const from = safeDate(sp.from, monthStart);
  const to = safeDate(sp.to, ctx.today);
  const asOf = safeDate(sp.asOf, ctx.today);
  const year = Number(sp.year) || ctx.today.getUTCFullYear();

  const [allTime, month, accounts, suppliers] = await Promise.all([
    balancesByAccount(prisma, [pid]),
    balancesByAccount(prisma, [pid], { from: monthStart, to: ctx.today }),
    prisma.account.findMany({ where: { propertyId: pid, isActive: true }, orderBy: { code: "asc" } }),
    prisma.supplier.findMany({ where: { propertyId: pid, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const bal = (code: string) => allTime.find((r) => r.code === code)?.net ?? D(0);
  const pl = profitAndLoss(month);
  const acctOpts: Opt[] = accounts.map((a) => [a.code, `${a.code} ${a.name}`]);
  const expenseOpts: Opt[] = accounts.filter((a) => a.type === "EXPENSE").map((a) => [a.code, `${a.code} ${a.name}`]);
  const canCreate = ctx.can("finance.create");
  const canEdit = ctx.can("finance.edit");
  const canApprove = ctx.can("finance.approve");
  const closed = ctx.property.booksClosedThrough;
  const range = (t: string) => (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={t} />
      <label className="text-xs text-ink-3">From<Input type="date" name="from" defaultValue={toDateOnlyString(from)} className="w-40" /></label>
      <label className="text-xs text-ink-3">To<Input type="date" name="to" defaultValue={toDateOnlyString(to)} className="w-40" /></label>
      <Button type="submit" variant="secondary" size="sm">Apply</Button>
      <LinkButton href={`/api/reports/${t === "pl" ? "profit-loss" : "trial-balance"}?from=${toDateOnlyString(from)}&to=${toDateOnlyString(to)}`} variant="ghost" size="sm">Export CSV</LinkButton>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Finance & accounting"
        description={`Every figure is computed from posted, double-entry journal entries.${closed ? ` Books closed through ${formatDate(closed)}.` : ""}`}
        actions={canCreate && (
          <div className="flex gap-2">
            <LinkButton href="/finance/journal/new" variant="secondary" size="sm">Manual journal</LinkButton>
            <FormDialog action={recordExpenseAction} title="Record an expense" trigger="Record expense" wide
              description="Paid now posts Dr expense / Cr cash or bank. On account raises a supplier bill to pay from Payables."
              fields={[
                { name: "date", label: "Date", type: "date", required: true, defaultValue: toDateOnlyString(ctx.today) },
                { name: "amount", label: "Amount", type: "number", required: true },
                { name: "account", label: "Expense account", type: "select", options: expenseOpts, required: true, span: 4, empty: "Choose…" },
                { name: "description", label: "Description", required: true, span: 4 },
                { name: "paidBy", label: "Paid by", type: "select", options: [["CASH", "Cash"], ["BANK_TRANSFER", "Bank"], ["ON_ACCOUNT", "On account (owe supplier)"]], required: true, defaultValue: "CASH" },
                { name: "supplierId", label: "Supplier", type: "select", options: suppliers.map((s) => [s.id, s.name]) },
                { name: "reference", label: "Receipt / invoice no.", span: 4 },
              ]} />
          </div>
        )}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Revenue (this month)" value={money(pl.totalIncome)} />
        <Stat label="Expenses (this month)" value={money(pl.totalExpense)} />
        <Stat label="Net profit (this month)" value={money(pl.net)} tone={pl.net.isNegative() ? "danger" : "ok"} />
        <Stat label="Cash + bank" value={money(bal("1000").plus(bal("1010")))} />
        <Stat label="Receivable" value={money(bal("1100"))} />
        <Stat label="Payable" value={money(bal("2000").negated())} tone={bal("2000").isNegative() ? "warn" : undefined} />
        <Stat label="Taxes payable" value={money(bal("2200").negated())} />
      </div>
      <Tabs active={tab} items={[
        { key: "overview", label: "Trial balance", href: "/finance?tab=overview" },
        { key: "journal", label: "Journal", href: "/finance?tab=journal" },
        { key: "pl", label: "Profit & loss", href: "/finance?tab=pl" },
        { key: "bs", label: "Balance sheet", href: "/finance?tab=bs" },
        { key: "ar", label: "Receivables", href: "/finance?tab=ar" },
        { key: "ap", label: "Payables", href: "/finance?tab=ap" },
        { key: "expenses", label: "Expenses", href: "/finance?tab=expenses" },
        { key: "budget", label: "Budget", href: "/finance?tab=budget" },
        { key: "accounts", label: "Chart of accounts", href: "/finance?tab=accounts" },
        { key: "close", label: "Period close", href: "/finance?tab=close" },
      ]} />

      {tab === "overview" && <TrialBalance pid={pid} from={from} to={to} money={money} range={range("overview")} />}
      {tab === "journal" && <Journal pid={pid} money={money} canReverse={canEdit} today={ctx.today} />}
      {tab === "pl" && (
        <>
          {range("pl")}
          <ProfitLoss pid={pid} from={from} to={to} money={money} />
        </>
      )}
      {tab === "bs" && <BalanceSheetView pid={pid} asOf={asOf} money={money} />}
      {tab === "ar" && <Receivables pid={pid} today={ctx.today} money={money} />}
      {tab === "ap" && <Payables pid={pid} today={ctx.today} money={money} canPay={canCreate || ctx.can("procurement.edit")} />}
      {tab === "expenses" && <Expenses pid={pid} money={money} />}
      {tab === "budget" && (
        <Card>
          <CardHeader title={`Budget vs actual ${year}`} description="Year to date. The annual budget is prorated by days elapsed."
            actions={<div className="flex gap-1">{[year - 1, year, year + 1].map((y) => <LinkButton key={y} href={`/finance?tab=budget&year=${y}`} variant={y === year ? "primary" : "ghost"} size="sm">{y}</LinkButton>)}</div>} />
          <BudgetView pid={pid} year={year} today={ctx.today} money={money} canEdit={canEdit} accounts={accounts.filter((a) => a.type === "INCOME" || a.type === "EXPENSE").map((a) => [a.code, `${a.code} ${a.name}`] as Opt)} />
        </Card>
      )}
      {tab === "accounts" && (
        <Card>
          <CardHeader title="Chart of accounts" actions={canEdit && (
            <FormDialog action={addAccountAction} title="Add an account" trigger="Add account"
              fields={[
                { name: "code", label: "Code", required: true, placeholder: "5110", span: 1 },
                { name: "name", label: "Name", required: true, span: 3 },
                { name: "type", label: "Type", type: "select", options: [["ASSET", "Asset (1xxx)"], ["LIABILITY", "Liability (2xxx)"], ["EQUITY", "Equity (3xxx)"], ["INCOME", "Income (4xxx)"], ["EXPENSE", "Expense (5xxx)"]], required: true, span: 4 },
              ]} />
          )} />
          <Table>
            <THead><tr><TH>Code</TH><TH>Account</TH><TH>Type</TH><TH className="text-right">Balance</TH></tr></THead>
            <TBody>
              {accounts.map((a) => {
                const n = bal(a.code);
                const shown = ["ASSET", "EXPENSE"].includes(a.type) ? n : n.negated();
                return <TR key={a.id}><TD className="font-mono text-xs">{a.code}</TD><TD>{a.name}{a.isSystem && <span className="ml-2 text-[10px] text-ink-3">system</span>}</TD><TD className="text-xs capitalize">{a.type.toLowerCase()}</TD><TD className="text-right tabular-nums">{money(shown)}</TD></TR>;
              })}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "close" && (
        <Card>
          <CardHeader title="Period close" description="Closing locks every date on or before the close date: nothing can be posted, reversed or back-dated into it. Reopening needs Finance approval and is audited." />
          <CardBody className="space-y-4">
            <p className="text-sm">Books are {closed ? <>closed through <strong>{formatDate(closed)}</strong>.</> : <strong>open</strong>}</p>
            {canApprove ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Close the books</h3>
                  <InlineForm action={closeBooksAction} submitLabel="Close period" confirm="Close the books through this date? Nothing can be posted on or before it."
                    fields={[{ name: "through", label: "Close through", type: "date", required: true, defaultValue: toDateOnlyString(addDays(monthStart, -1)), span: 4 }]} />
                </div>
                {closed && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Reopen</h3>
                    <InlineForm action={reopenBooksAction} submitLabel="Reopen" confirm="Reopen the books?"
                      fields={[{ name: "through", label: "Keep closed through (blank = reopen all)", type: "date", span: 4 }]} />
                  </div>
                )}
              </div>
            ) : <p className="text-sm text-ink-3">You need Finance approval rights to close or reopen periods.</p>}
          </CardBody>
        </Card>
      )}
    </>
  );
}

type Money = (v: unknown) => string;

async function TrialBalance({ pid, from, to, money, range }: { pid: string; from: Date; to: Date; money: Money; range: React.ReactNode }) {
  const rows = await balancesByAccount(prisma, [pid], { to });
  const totalDr = sum(rows.filter((r) => r.net.greaterThan(0)).map((r) => r.net));
  const totalCr = sum(rows.filter((r) => r.net.lessThan(0)).map((r) => r.net.negated()));
  void from;
  return (
    <>
      {range}
      <Card>
        <CardHeader title={`Trial balance as of ${formatDate(to)}`} description="Cumulative balances to the “To” date." actions={totalDr.equals(totalCr) ? <Badge tone="ok">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>} />
        <Table>
          <THead><tr><TH>Code</TH><TH>Account</TH><TH>Type</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.code} className={r.net.isZero() ? "text-ink-3" : ""}><TD className="font-mono text-xs">{r.code}</TD><TD>{r.name}</TD><TD className="text-xs capitalize">{r.type.toLowerCase()}</TD><TD className="text-right tabular-nums">{r.net.greaterThan(0) ? money(r.net) : ""}</TD><TD className="text-right tabular-nums">{r.net.lessThan(0) ? money(r.net.negated()) : ""}</TD></TR>
            ))}
            <TR className="bg-muted/50 font-semibold"><TD /><TD>Total</TD><TD /><TD className="text-right tabular-nums">{money(totalDr)}</TD><TD className="text-right tabular-nums">{money(totalCr)}</TD></TR>
          </TBody>
        </Table>
      </Card>
    </>
  );
}

async function Journal({ pid, money, canReverse, today }: { pid: string; money: Money; canReverse: boolean; today: Date }) {
  const entries = await prisma.journalEntry.findMany({ where: { propertyId: pid }, include: { lines: { include: { account: true } }, reversedBy: true }, orderBy: [{ postedAt: "desc" }], take: 100 });
  return (
    <Card>
      <CardHeader title="Journal entries" description="Latest 100. Posted entries are immutable; corrections are reversals." />
      <Table>
        <THead><tr><TH>Entry</TH><TH>Date</TH><TH>Memo</TH><TH>Account</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
        <TBody>
          {entries.flatMap((e) => e.lines.map((l, i) => (
            <TR key={l.id} className={i === 0 ? "border-t-2 border-border" : ""}>
              <TD className="align-top font-mono text-xs">
                {i === 0 && (
                  <>
                    {e.number}
                    <div className="font-sans text-[10px] text-ink-3">{e.sourceType.toLowerCase().replaceAll("_", " ")}</div>
                    {e.reversedBy ? <Badge className="mt-1">Reversed</Badge> : canReverse && e.sourceType !== "REVERSAL" && (
                      <div className="mt-1 font-sans">
                        <FormDialog action={reverseEntryAction} title={`Reverse ${e.number}`} trigger="Reverse" triggerVariant="ghost" description="Posts an equal and opposite entry. The original stays on record."
                          fields={[{ name: "id", label: "", type: "hidden", defaultValue: e.id }, { name: "reason", label: "Reason", required: true, span: 4 }, { name: "date", label: "Reversal date", type: "date", defaultValue: toDateOnlyString(today), span: 4 }]} />
                      </div>
                    )}
                  </>
                )}
              </TD>
              <TD className="align-top text-xs whitespace-nowrap">{i === 0 ? formatDate(e.date) : ""}</TD>
              <TD className="max-w-xs align-top text-xs">{i === 0 ? e.memo : l.memo ?? ""}</TD>
              <TD className="text-xs"><span className="font-mono">{l.account.code}</span> {l.account.name}</TD>
              <TD className="text-right tabular-nums">{Number(l.debit) ? money(l.debit) : ""}</TD><TD className="text-right tabular-nums">{Number(l.credit) ? money(l.credit) : ""}</TD>
            </TR>
          )))}
        </TBody>
      </Table>
    </Card>
  );
}

async function ProfitLoss({ pid, from, to, money }: { pid: string; from: Date; to: Date; money: Money }) {
  const pl = profitAndLoss(await balancesByAccount(prisma, [pid], { from, to }));
  const section = (title: string, rows: { code: string; name: string; amount: ReturnType<typeof D> }[], total: ReturnType<typeof D>) => (
    <>
      <TR className="bg-muted/40"><TD colSpan={3} className="font-semibold">{title}</TD></TR>
      {rows.filter((r) => !r.amount.isZero()).map((r) => <TR key={r.code}><TD className="font-mono text-xs">{r.code}</TD><TD>{r.name}</TD><TD className="text-right tabular-nums">{money(r.amount)}</TD></TR>)}
      <TR className="font-semibold"><TD /><TD>Total {title.toLowerCase()}</TD><TD className="text-right tabular-nums">{money(total)}</TD></TR>
    </>
  );
  return (
    <Card>
      <CardHeader title="Profit & loss" description={`${formatDate(from)} – ${formatDate(to)}`} />
      <Table>
        <TBody>
          {section("Income", pl.income, pl.totalIncome)}
          {section("Expenses", pl.expense, pl.totalExpense)}
          <TR className="border-t-2 border-border text-base font-semibold"><TD /><TD>Net {pl.net.isNegative() ? "loss" : "profit"}</TD><TD className={`text-right tabular-nums ${pl.net.isNegative() ? "text-danger" : "text-ok"}`}>{money(pl.net)}</TD></TR>
        </TBody>
      </Table>
    </Card>
  );
}

async function BalanceSheetView({ pid, asOf, money }: { pid: string; asOf: Date; money: Money }) {
  const bs = balanceSheet(await balancesByAccount(prisma, [pid], { to: asOf }));
  const rows = (list: { code: string; name: string; amount: ReturnType<typeof D> }[]) => list.filter((r) => !r.amount.isZero()).map((r) => <TR key={r.code}><TD className="font-mono text-xs">{r.code}</TD><TD>{r.name}</TD><TD className="text-right tabular-nums">{money(r.amount)}</TD></TR>);
  return (
    <>
      <form method="get" className="mb-4 flex items-end gap-2">
        <input type="hidden" name="tab" value="bs" />
        <label className="text-xs text-ink-3">As of<Input type="date" name="asOf" defaultValue={toDateOnlyString(asOf)} className="w-40" /></label>
        <Button type="submit" variant="secondary" size="sm">Apply</Button>
        <LinkButton href={`/api/reports/balance-sheet?asOf=${toDateOnlyString(asOf)}`} variant="ghost" size="sm">Export CSV</LinkButton>
      </form>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Assets" description={`As of ${formatDate(asOf)}`} />
          <Table><TBody>{rows(bs.assets)}<TR className="font-semibold"><TD /><TD>Total assets</TD><TD className="text-right tabular-nums">{money(bs.totalAssets)}</TD></TR></TBody></Table>
        </Card>
        <Card>
          <CardHeader title="Liabilities & equity" actions={bs.balanced ? <Badge tone="ok">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>} />
          <Table>
            <TBody>
              <TR className="bg-muted/40"><TD colSpan={3} className="font-semibold">Liabilities</TD></TR>
              {rows(bs.liabilities)}
              <TR className="font-semibold"><TD /><TD>Total liabilities</TD><TD className="text-right tabular-nums">{money(bs.totalLiabilities)}</TD></TR>
              <TR className="bg-muted/40"><TD colSpan={3} className="font-semibold">Equity</TD></TR>
              {rows(bs.equity)}
              <TR><TD /><TD>Current earnings (unclosed profit)</TD><TD className="text-right tabular-nums">{money(bs.earnings)}</TD></TR>
              <TR className="font-semibold"><TD /><TD>Total equity</TD><TD className="text-right tabular-nums">{money(bs.totalEquity)}</TD></TR>
              <TR className="border-t-2 border-border font-semibold"><TD /><TD>Liabilities + equity</TD><TD className="text-right tabular-nums">{money(bs.totalLiabilities.plus(bs.totalEquity))}</TD></TR>
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

async function Receivables({ pid, today, money }: { pid: string; today: Date; money: Money }) {
  const ar = await receivablesAging(prisma, pid, today);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {ar.buckets.map((b, i) => <Stat key={b} label={b === "Current" ? "Current" : `${b} days`} value={money(ar.totals[i])} tone={i >= 3 && !ar.totals[i].isZero() ? "danger" : undefined} />)}
        <Stat label="Total outstanding" value={money(ar.total)} tone="warn" />
      </div>
      <Card>
        <CardHeader title="Outstanding guest & event balances" description="Balances left after check-out or event completion, aged from the invoice date. Collect them from the reservation or event page." />
        {ar.rows.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
          <Table>
            <THead><tr><TH>Bill to</TH><TH>Invoice</TH><TH>Folio</TH><TH className="text-right">Days</TH><TH className="text-right">Balance</TH></tr></THead>
            <TBody>
              {ar.rows.map((r) => (
                <TR key={r.folioId}>
                  <TD>{r.link ? <Link href={r.link} className="font-medium hover:underline">{r.name}</Link> : r.name}</TD>
                  <TD className="font-mono text-xs">{r.invoiceId ? <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">{r.invoice}</Link> : "—"}</TD>
                  <TD className="font-mono text-xs">{r.folio}</TD>
                  <TD className={`text-right tabular-nums ${r.days > 60 ? "text-danger" : ""}`}>{r.days}</TD>
                  <TD className="text-right font-medium tabular-nums">{money(r.balance)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Payables({ pid, today, money, canPay }: { pid: string; today: Date; money: Money; canPay: boolean }) {
  const ap = await payablesAging(prisma, pid, today);
  const paid = await prisma.supplierBill.findMany({ where: { propertyId: pid, status: "PAID" }, include: { supplier: true }, orderBy: { billDate: "desc" }, take: 20 });
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {ap.buckets.map((b, i) => <Stat key={b} label={b === "Current" ? "Not yet due" : `${b} days overdue`} value={money(ap.totals[i])} tone={i >= 2 && !ap.totals[i].isZero() ? "danger" : undefined} />)}
        <Stat label="Total owed" value={money(ap.total)} tone="warn" />
      </div>
      <Card className="mb-4">
        <CardHeader title="Unpaid supplier bills" description="Bills come from goods received against purchase orders, expenses on account and repair costs." />
        {ap.rows.length === 0 ? <EmptyState title="No unpaid bills" /> : (
          <Table>
            <THead><tr><TH>Bill</TH><TH>Supplier</TH><TH>Description</TH><TH>Due</TH><TH className="text-right">Amount</TH><TH className="text-right">Owed</TH><TH /></tr></THead>
            <TBody>
              {ap.rows.map((b) => (
                <TR key={b.id}>
                  <TD className="font-mono text-xs">{b.number}{b.supplierRef && <div className="font-sans text-[10px] text-ink-3">Ref {b.supplierRef}</div>}</TD>
                  <TD className="text-sm">{b.supplier.name}</TD>
                  <TD className="max-w-xs text-xs">{b.description}</TD>
                  <TD className={`text-xs whitespace-nowrap ${b.overdue > 0 ? "font-medium text-danger" : ""}`}>{formatDate(b.dueDate)}{b.overdue > 0 && ` (${b.overdue}d late)`}</TD>
                  <TD className="text-right tabular-nums">{money(b.amount)}</TD>
                  <TD className="text-right font-medium tabular-nums">{money(b.owed)}</TD>
                  <TD className="text-right">
                    {canPay && (
                      <FormDialog action={payBillAction} title={`Pay ${b.number}`} trigger="Pay" description={`${b.supplier.name} · ${money(b.owed)} owed`}
                        fields={[
                          { name: "billId", label: "", type: "hidden", defaultValue: b.id },
                          { name: "amount", label: "Amount", type: "number", required: true, defaultValue: b.owed.toFixed(2) },
                          { name: "method", label: "Paid from", type: "select", options: PAY, required: true, defaultValue: "BANK_TRANSFER" },
                          { name: "date", label: "Date", type: "date", defaultValue: toDateOnlyString(today) },
                          { name: "reference", label: "Reference" },
                        ]} />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {paid.length > 0 && (
        <Card>
          <CardHeader title="Recently paid" />
          <Table>
            <THead><tr><TH>Bill</TH><TH>Supplier</TH><TH>Date</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></THead>
            <TBody>{paid.map((b) => <TR key={b.id}><TD className="font-mono text-xs">{b.number}</TD><TD className="text-sm">{b.supplier.name}</TD><TD className="text-xs">{formatDate(b.billDate)}</TD><TD className="text-right tabular-nums">{money(b.amount)}</TD><TD><StatusBadge status={b.status} /></TD></TR>)}</TBody>
          </Table>
        </Card>
      )}
    </>
  );
}

async function Expenses({ pid, money }: { pid: string; money: Money }) {
  const rows = await prisma.expense.findMany({ where: { propertyId: pid }, include: { supplier: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 });
  const names = new Map((await prisma.account.findMany({ where: { propertyId: pid } })).map((a) => [a.code, a.name]));
  return (
    <Card>
      <CardHeader title="Expenses" description="Operating expenses recorded directly. Stock, payroll and purchase costs post through their own modules." />
      {rows.length === 0 ? <EmptyState title="No expenses recorded" /> : (
        <Table>
          <THead><tr><TH>No.</TH><TH>Date</TH><TH>Account</TH><TH>Description</TH><TH>Paid by</TH><TH className="text-right">Amount</TH></tr></THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id}>
                <TD className="font-mono text-xs">{e.number}</TD><TD className="text-xs">{formatDate(e.date)}</TD>
                <TD className="text-xs"><span className="font-mono">{e.account}</span> {names.get(e.account)}</TD>
                <TD className="text-sm">{e.description}{e.reference && <span className="text-ink-3"> · {e.reference}</span>}</TD>
                <TD className="text-xs">{e.paidBy === "ON_ACCOUNT" ? `On account · ${e.supplier?.name ?? ""}` : e.paidBy === "CASH" ? "Cash" : "Bank"}</TD>
                <TD className="text-right tabular-nums">{money(e.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

async function BudgetView({ pid, year, today, money, canEdit, accounts }: { pid: string; year: number; today: Date; money: Money; canEdit: boolean; accounts: Opt[] }) {
  const rows = await budgetVsActual(prisma, pid, year, today);
  const budgeted = rows.filter((r) => r.hasBudget);
  const initial = (budgeted.length ? budgeted : rows.filter((r) => !r.actual.isZero())).map((r) => ({ account: r.code, amount: r.annual.isZero() ? "" : r.annual.toFixed(2) }));
  return (
    <>
      <Table>
        <THead><tr><TH>Account</TH><TH className="text-right">Annual budget</TH><TH className="text-right">Budget to date</TH><TH className="text-right">Actual to date</TH><TH className="text-right">Variance</TH></tr></THead>
        <TBody>
          {rows.filter((r) => r.hasBudget || !r.actual.isZero()).map((r) => {
            const good = r.type === "INCOME" ? !r.variance.isNegative() : !r.variance.greaterThan(0);
            return (
              <TR key={r.code}>
                <TD className="text-sm"><span className="font-mono text-xs">{r.code}</span> {r.name}</TD>
                <TD className="text-right tabular-nums">{r.hasBudget ? money(r.annual) : "—"}</TD>
                <TD className="text-right tabular-nums">{r.hasBudget ? money(r.toDate) : "—"}</TD>
                <TD className="text-right tabular-nums">{money(r.actual)}</TD>
                <TD className={`text-right tabular-nums ${r.hasBudget ? (good ? "text-ok" : "text-danger") : "text-ink-3"}`}>{r.hasBudget ? money(r.variance) : "—"}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {canEdit && (
        <CardBody className="border-t border-border">
          <h3 className="mb-2 text-sm font-semibold">Set annual budget for {year}</h3>
          <LinesForm action={setBudgetAction} submitLabel="Save budget" addLabel="Add account" initialRows={initial.length ? initial : 3}
            fields={[{ name: "year", label: "", type: "hidden", defaultValue: year }]}
            columns={[{ name: "account", label: "Account", type: "select", options: accounts }, { name: "amount", label: "Annual amount", type: "number", width: "12rem" }]} />
        </CardBody>
      )}
    </>
  );
}
