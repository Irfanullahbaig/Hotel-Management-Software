import { prisma } from "@/lib/db";
import { toDateOnlyString } from "@/lib/dates";
import { D, sum } from "@/lib/money";
import { balanceSheet, balancesByAccount, dailyKpis, payablesAging, profitAndLoss, receivablesAging } from "./accounting";
import { stockOnHand } from "./inventory";

export type Col = { label: string; kind?: "text" | "money" | "number" | "pct" };
export type Report = { title: string; description: string; columns: Col[]; rows: (string | number)[][]; total?: (string | number)[] };

export const REPORTS: Record<string, { label: string; group: string; range: "range" | "asOf" | "none"; perm: string }> = {
  daily: { label: "Occupancy, ADR & RevPAR", group: "Rooms", range: "range", perm: "reports.view" },
  sources: { label: "Bookings by source", group: "Rooms", range: "range", perm: "reports.view" },
  revenue: { label: "Revenue by department", group: "Revenue", range: "range", perm: "reports.view" },
  pos: { label: "Restaurant item sales", group: "Revenue", range: "range", perm: "reports.view" },
  services: { label: "Service sales", group: "Revenue", range: "range", perm: "reports.view" },
  "profit-loss": { label: "Profit & loss", group: "Finance", range: "range", perm: "finance.view" },
  "trial-balance": { label: "Trial balance", group: "Finance", range: "range", perm: "finance.view" },
  "balance-sheet": { label: "Balance sheet", group: "Finance", range: "asOf", perm: "finance.view" },
  "ar-aging": { label: "Receivables aging", group: "Finance", range: "asOf", perm: "finance.view" },
  "ap-aging": { label: "Payables aging", group: "Finance", range: "asOf", perm: "finance.view" },
  inventory: { label: "Inventory valuation", group: "Operations", range: "none", perm: "inventory.view" },
  maintenance: { label: "Maintenance log", group: "Operations", range: "range", perm: "maintenance.view" },
  feedback: { label: "Guest feedback", group: "Guests", range: "range", perm: "reports.view" },
};

const n2 = (v: unknown) => Number(D(v as string).toFixed(2));
const endOfDay = (d: Date) => new Date(d.getTime() + 86400000 - 1);

export async function buildReport(key: string, propertyId: string, p: { from: Date; to: Date; asOf: Date }): Promise<Report | null> {
  switch (key) {
    case "daily": {
      const k = await dailyKpis(prisma, propertyId, p.from, p.to);
      const rows = k.days.map((d) => [toDateOnlyString(d.date), d.sold, Number(d.occupancy.toFixed(1)), n2(d.adr), n2(d.revpar), n2(d.roomRevenue), n2(d.totalRevenue)]);
      const sold = k.days.reduce((a, d) => a + d.sold, 0);
      const rr = sum(k.days.map((d) => d.roomRevenue));
      const avail = k.rooms * k.days.length;
      return {
        title: "Occupancy, ADR & RevPAR", description: `${k.rooms} rooms. Rooms sold counts booked nights; revenue is what was posted to the ledger.`,
        columns: [{ label: "Date" }, { label: "Rooms sold", kind: "number" }, { label: "Occupancy %", kind: "pct" }, { label: "ADR", kind: "money" }, { label: "RevPAR", kind: "money" }, { label: "Room revenue", kind: "money" }, { label: "Total revenue", kind: "money" }],
        rows,
        total: ["Total / average", sold, avail ? Number(((sold / avail) * 100).toFixed(1)) : 0, sold ? n2(rr.dividedBy(sold)) : 0, avail ? n2(rr.dividedBy(avail)) : 0, n2(rr), n2(sum(k.days.map((d) => d.totalRevenue)))],
      };
    }
    case "sources": {
      const res = await prisma.reservation.findMany({ where: { propertyId, checkIn: { gte: p.from, lte: p.to } }, select: { source: true, status: true, grandTotal: true, checkIn: true, checkOut: true } });
      const by = new Map<string, { n: number; cancelled: number; nights: number; value: ReturnType<typeof D> }>();
      for (const r of res) {
        const e = by.get(r.source) ?? { n: 0, cancelled: 0, nights: 0, value: D(0) };
        e.n++;
        if (r.status === "CANCELLED" || r.status === "NO_SHOW") e.cancelled++;
        else { e.nights += Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / 86400000); e.value = e.value.plus(r.grandTotal); }
        by.set(r.source, e);
      }
      const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([s, e]) => [s.replaceAll("_", " ").toLowerCase(), e.n, e.cancelled, e.nights, n2(e.value)]);
      return { title: "Bookings by source", description: "Reservations arriving in the period.", columns: [{ label: "Source" }, { label: "Bookings", kind: "number" }, { label: "Cancelled / no-show", kind: "number" }, { label: "Nights", kind: "number" }, { label: "Booked value", kind: "money" }], rows, total: ["Total", res.length, rows.reduce((a, r) => a + Number(r[2]), 0), rows.reduce((a, r) => a + Number(r[3]), 0), n2(sum(rows.map((r) => r[4] as number)))] };
    }
    case "revenue": {
      const pl = profitAndLoss(await balancesByAccount(prisma, [propertyId], { from: p.from, to: p.to }));
      const rows = pl.income.filter((r) => !r.amount.isZero()).map((r) => [r.code, r.name, n2(r.amount), pl.totalIncome.isZero() ? 0 : Number(r.amount.dividedBy(pl.totalIncome).times(100).toFixed(1))]);
      return { title: "Revenue by department", description: "Posted income, net of discounts.", columns: [{ label: "Account" }, { label: "Department" }, { label: "Revenue", kind: "money" }, { label: "Share %", kind: "pct" }], rows, total: ["", "Total", n2(pl.totalIncome), 100] };
    }
    case "pos": {
      const items = await prisma.posOrderItem.groupBy({ by: ["name"], where: { status: { not: "VOID" }, order: { propertyId, status: "SETTLED", settledAt: { gte: p.from, lte: endOfDay(p.to) } } }, _sum: { quantity: true, amount: true }, orderBy: { _sum: { amount: "desc" } } });
      const rows = items.map((i) => [i.name, i._sum.quantity ?? 0, n2(i._sum.amount)]);
      return { title: "Restaurant item sales", description: "Settled orders, before discount, service charge and tax.", columns: [{ label: "Item" }, { label: "Qty", kind: "number" }, { label: "Sales", kind: "money" }], rows, total: ["Total", rows.reduce((a, r) => a + Number(r[1]), 0), n2(sum(rows.map((r) => r[2] as number)))] };
    }
    case "services": {
      const orders = await prisma.serviceOrder.findMany({ where: { propertyId, status: "DELIVERED", deliveredAt: { gte: p.from, lte: endOfDay(p.to) } }, include: { serviceItem: true } });
      const by = new Map<string, { cat: string; q: number; a: ReturnType<typeof D> }>();
      for (const o of orders) {
        const e = by.get(o.serviceItem.name) ?? { cat: o.serviceItem.category, q: 0, a: D(0) };
        e.q += o.quantity; e.a = e.a.plus(o.amount);
        by.set(o.serviceItem.name, e);
      }
      const rows = [...by.entries()].map(([n, e]) => [n, e.cat.toLowerCase(), e.q, n2(e.a)]);
      return { title: "Service sales", description: "Delivered service orders, before service charge and tax.", columns: [{ label: "Service" }, { label: "Category" }, { label: "Qty", kind: "number" }, { label: "Sales", kind: "money" }], rows, total: ["Total", "", rows.reduce((a, r) => a + Number(r[2]), 0), n2(sum(rows.map((r) => r[3] as number)))] };
    }
    case "profit-loss": {
      const pl = profitAndLoss(await balancesByAccount(prisma, [propertyId], { from: p.from, to: p.to }));
      const rows = [
        ...pl.income.filter((r) => !r.amount.isZero()).map((r) => ["Income", r.code, r.name, n2(r.amount)]),
        ["Income", "", "Total income", n2(pl.totalIncome)],
        ...pl.expense.filter((r) => !r.amount.isZero()).map((r) => ["Expense", r.code, r.name, n2(r.amount)]),
        ["Expense", "", "Total expenses", n2(pl.totalExpense)],
      ];
      return { title: "Profit & loss", description: "", columns: [{ label: "Section" }, { label: "Code" }, { label: "Account" }, { label: "Amount", kind: "money" }], rows, total: ["", "", "Net profit", n2(pl.net)] };
    }
    case "trial-balance": {
      const rows = (await balancesByAccount(prisma, [propertyId], { to: p.to })).filter((r) => !r.net.isZero());
      return {
        title: "Trial balance", description: `Cumulative to ${toDateOnlyString(p.to)}.`, columns: [{ label: "Code" }, { label: "Account" }, { label: "Type" }, { label: "Debit", kind: "money" }, { label: "Credit", kind: "money" }],
        rows: rows.map((r) => [r.code, r.name, r.type.toLowerCase(), r.net.greaterThan(0) ? n2(r.net) : 0, r.net.lessThan(0) ? n2(r.net.negated()) : 0]),
        total: ["", "Total", "", n2(sum(rows.filter((r) => r.net.greaterThan(0)).map((r) => r.net))), n2(sum(rows.filter((r) => r.net.lessThan(0)).map((r) => r.net.negated())))],
      };
    }
    case "balance-sheet": {
      const bs = balanceSheet(await balancesByAccount(prisma, [propertyId], { to: p.asOf }));
      const rows = [
        ...bs.assets.filter((r) => !r.amount.isZero()).map((r) => ["Assets", r.code, r.name, n2(r.amount)]),
        ["Assets", "", "Total assets", n2(bs.totalAssets)],
        ...bs.liabilities.filter((r) => !r.amount.isZero()).map((r) => ["Liabilities", r.code, r.name, n2(r.amount)]),
        ["Liabilities", "", "Total liabilities", n2(bs.totalLiabilities)],
        ...bs.equity.filter((r) => !r.amount.isZero()).map((r) => ["Equity", r.code, r.name, n2(r.amount)]),
        ["Equity", "", "Current earnings", n2(bs.earnings)],
        ["Equity", "", "Total equity", n2(bs.totalEquity)],
      ];
      return { title: "Balance sheet", description: `As of ${toDateOnlyString(p.asOf)}.`, columns: [{ label: "Section" }, { label: "Code" }, { label: "Account" }, { label: "Amount", kind: "money" }], rows, total: ["", "", "Liabilities + equity", n2(bs.totalLiabilities.plus(bs.totalEquity))] };
    }
    case "ar-aging": {
      const ar = await receivablesAging(prisma, propertyId, p.asOf);
      return { title: "Receivables aging", description: "Days since the invoice.", columns: [{ label: "Bill to" }, { label: "Invoice" }, { label: "Days", kind: "number" }, { label: "Bucket" }, { label: "Balance", kind: "money" }], rows: ar.rows.map((r) => [r.name, r.invoice ?? "", r.days, ar.buckets[r.bucket], n2(r.balance)]), total: ["Total", "", "", "", n2(ar.total)] };
    }
    case "ap-aging": {
      const ap = await payablesAging(prisma, propertyId, p.asOf);
      return { title: "Payables aging", description: "Days past the due date.", columns: [{ label: "Bill" }, { label: "Supplier" }, { label: "Due" }, { label: "Days overdue", kind: "number" }, { label: "Owed", kind: "money" }], rows: ap.rows.map((r) => [r.number, r.supplier.name, toDateOnlyString(r.dueDate), Math.max(0, r.overdue), n2(r.owed)]), total: ["Total", "", "", "", n2(ap.total)] };
    }
    case "inventory": {
      const items = await prisma.inventoryItem.findMany({ where: { propertyId, isActive: true }, include: { levels: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
      const rows = items.map((i) => { const q = stockOnHand(i); return [i.sku, i.name, i.category.toLowerCase(), Number(q.toString()), i.unit, n2(i.avgCost), n2(q.times(i.avgCost))]; });
      return { title: "Inventory valuation", description: "Current stock at weighted-average cost. Should agree with account 1200.", columns: [{ label: "SKU" }, { label: "Item" }, { label: "Category" }, { label: "On hand", kind: "number" }, { label: "Unit" }, { label: "Avg cost", kind: "money" }, { label: "Value", kind: "money" }], rows, total: ["", "Total", "", "", "", "", n2(sum(rows.map((r) => r[6] as number)))] };
    }
    case "maintenance": {
      const reqs = await prisma.maintenanceRequest.findMany({ where: { propertyId, createdAt: { gte: p.from, lte: endOfDay(p.to) } }, include: { room: true, assignee: true }, orderBy: { createdAt: "asc" } });
      const rows = reqs.map((r) => [r.number ?? "", toDateOnlyString(r.createdAt), r.room ? `Room ${r.room.number}` : "Public area", r.category.toLowerCase(), r.title, r.priority.toLowerCase(), r.status.toLowerCase(), r.assignee?.name ?? "", r.resolvedAt ? Number(((r.resolvedAt.getTime() - r.createdAt.getTime()) / 3600000).toFixed(1)) : "", n2(r.cost)]);
      return { title: "Maintenance log", description: "Requests raised in the period.", columns: [{ label: "No." }, { label: "Raised" }, { label: "Where" }, { label: "Category" }, { label: "Issue" }, { label: "Priority" }, { label: "Status" }, { label: "Technician" }, { label: "Hours to close", kind: "number" }, { label: "Cost", kind: "money" }], rows, total: ["Total", "", "", "", `${reqs.length} requests`, "", "", "", "", n2(sum(reqs.map((r) => r.cost)))] };
    }
    case "feedback": {
      const fb = await prisma.guestFeedback.findMany({ where: { propertyId, createdAt: { gte: p.from, lte: endOfDay(p.to) } }, include: { guest: true }, orderBy: { createdAt: "desc" } });
      const rated = fb.filter((f) => f.rating);
      return {
        title: "Guest feedback", description: rated.length ? `Average rating ${(rated.reduce((a, f) => a + (f.rating ?? 0), 0) / rated.length).toFixed(2)} / 5 from ${rated.length} ratings.` : "No ratings in the period.",
        columns: [{ label: "Date" }, { label: "Guest" }, { label: "Type" }, { label: "Category" }, { label: "Rating", kind: "number" }, { label: "Comments" }, { label: "Status" }],
        rows: fb.map((f) => [toDateOnlyString(f.createdAt), f.guest ? `${f.guest.firstName} ${f.guest.lastName}` : "Anonymous", f.kind.toLowerCase(), f.category.toLowerCase(), f.rating ?? "", f.comments, f.status.toLowerCase()]),
      };
    }
  }
  return null;
}

export function toCsv(r: Report) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [r.columns.map((c) => c.label), ...r.rows, ...(r.total ? [r.total] : [])].map((row) => row.map(esc).join(",")).join("\n");
}
