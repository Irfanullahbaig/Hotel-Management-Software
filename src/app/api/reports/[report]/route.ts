import { NextResponse, type NextRequest } from "next/server";
import { businessToday, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { can, requireProperty } from "@/server/auth/context";
import { REPORTS, buildReport, toCsv } from "@/server/services/reports";
import { audit } from "@/server/services/common";
import { prisma } from "@/lib/db";

const safe = (v: string | null, f: Date) => { try { return v ? parseDateOnly(v) : f; } catch { return f; } };

export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const meta = REPORTS[report];
  if (!meta) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const ctx = await requireProperty();
  const exportPerm = meta.perm.replace(".view", ".export");
  if (!can(ctx, meta.perm) || !(can(ctx, exportPerm) || can(ctx, "reports.export"))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const today = businessToday(ctx.property.timeZone);
  const sp = req.nextUrl.searchParams;
  const p = { from: safe(sp.get("from"), new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: safe(sp.get("to"), today), asOf: safe(sp.get("asOf"), today) };
  const r = await buildReport(report, ctx.property.id, p);
  if (!r) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  await audit(prisma, { userId: ctx.user.id, propertyId: ctx.property.id }, "report.export", "Report", report, `Exported ${r.title}`);
  const stamp = meta.range === "range" ? `${toDateOnlyString(p.from)}_${toDateOnlyString(p.to)}` : toDateOnlyString(p.asOf);
  return new NextResponse(toCsv(r), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${ctx.property.code}-${report}-${stamp}.csv"` },
  });
}
