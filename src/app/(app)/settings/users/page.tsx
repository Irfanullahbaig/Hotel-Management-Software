import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pageAuth("users.view");
  if (!ctx) return <Forbidden />;
  const q = (await searchParams).q?.trim();
  const users = await prisma.user.findMany({
    where: { organizationId: ctx.user.organizationId, ...(ctx.user.isSuperAdmin ? {} : { properties: { some: { propertyId: { in: ctx.properties.map((p) => p.id) } } } }), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { roles: { include: { role: true } }, properties: { include: { property: true } } },
    orderBy: { name: "asc" },
  });
  return (
    <Card>
      <CardHeader title="Users" description={`${users.length} accounts`} actions={<>
        <form method="get"><input name="q" defaultValue={q} placeholder="Search" className="h-8 rounded-md border border-border px-2 text-sm" aria-label="Search users" /></form>
        {ctx.can("users.create") && <LinkButton href="/settings/users/new" size="sm"><Plus className="size-4" /> New user</LinkButton>}
      </>} />
      <Table>
        <THead><tr><TH>Name</TH><TH>Roles</TH><TH>Properties</TH><TH>Department</TH><TH>Status</TH><TH>Last sign-in</TH></tr></THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD><Link href={`/settings/users/${u.id}`} className="font-medium text-brand hover:underline">{u.name}</Link><div className="text-xs text-ink-3">{u.email}</div></TD>
              <TD><div className="flex flex-wrap gap-1">{u.isSuperAdmin && <Badge tone="violet">Super Admin</Badge>}{u.roles.filter((r) => r.role.key !== "super_admin").map((r) => <Badge key={r.id}>{r.role.name}</Badge>)}</div></TD>
              <TD className="text-xs">{u.properties.map((p) => p.property.code).join(", ")}</TD>
              <TD className="text-xs">{u.department ?? "—"}</TD>
              <TD><StatusBadge status={u.lockedUntil && u.lockedUntil > new Date() ? "LOCKED" : u.status} /></TD>
              <TD className="text-xs text-ink-2">{formatDateTime(u.lastLoginAt, ctx.property.timeZone)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
