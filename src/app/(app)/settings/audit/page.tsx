import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden, Pagination } from "@/components/ui/layout";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageAuth("audit.view");
  if (!ctx) return <Forbidden />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    OR: [{ propertyId: ctx.property.id }, { propertyId: null, user: { organizationId: ctx.user.organizationId } }],
    userId: sp.user || undefined,
    action: sp.action ? { startsWith: sp.action } : undefined,
    ...(sp.q ? { summary: { contains: sp.q, mode: "insensitive" } } : {}),
  };
  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { user: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ where: { organizationId: ctx.user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const qs = (p: number) => "?" + new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <Card>
      <form className="flex flex-wrap gap-2 border-b border-border p-3" method="get">
        <Input name="q" defaultValue={sp.q} placeholder="Search summary" className="w-60" aria-label="Search" />
        <Select name="user" defaultValue={sp.user ?? ""} className="w-48" aria-label="User"><option value="">All users</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <Select name="action" defaultValue={sp.action ?? ""} className="w-48" aria-label="Area"><option value="">All areas</option>{["auth", "reservation", "frontdesk", "room", "guest", "user", "role", "settings", "housekeeping", "session"].map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Table>
        <THead><tr><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Summary</TH><TH>IP</TH></tr></THead>
        <TBody>{rows.map((a) => (
          <TR key={a.id}><TD className="text-xs whitespace-nowrap">{formatDateTime(a.createdAt, ctx.property.timeZone)}</TD><TD className="text-xs">{a.user?.name ?? "System"}</TD><TD className="font-mono text-xs">{a.action}</TD><TD>{a.summary}</TD><TD className="text-xs text-ink-3">{a.ip}</TD></TR>
        ))}</TBody>
      </Table>
      <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => `/settings/audit${qs(p)}`} />
    </Card>
  );
}
