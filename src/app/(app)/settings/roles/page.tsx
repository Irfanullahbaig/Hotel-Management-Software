import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const ctx = await pageAuth("roles.view");
  if (!ctx) return <Forbidden />;
  const roles = await prisma.role.findMany({ where: { organizationId: ctx.user.organizationId }, include: { _count: { select: { users: true, permissions: true } } }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
  return (
    <Card>
      <CardHeader title="Roles" description="Built-in roles can be adjusted; custom roles can be created for any mix of permissions." actions={ctx.can("roles.create") && <LinkButton href="/settings/roles/new" size="sm"><Plus className="size-4" /> New role</LinkButton>} />
      <Table>
        <THead><tr><TH>Role</TH><TH>Type</TH><TH className="text-right">Permissions</TH><TH className="text-right">Users</TH></tr></THead>
        <TBody>{roles.map((r) => (
          <TR key={r.id}><TD><Link href={`/settings/roles/${r.id}`} className="font-medium text-brand hover:underline">{r.name}</Link><div className="text-xs text-ink-3">{r.description}</div></TD><TD>{r.isSystem ? <Badge>Built-in</Badge> : <Badge tone="info">Custom</Badge>}</TD><TD className="text-right tabular-nums">{r.key === "super_admin" ? "All" : r._count.permissions}</TD><TD className="text-right tabular-nums">{r._count.users}</TD></TR>
        ))}</TBody>
      </Table>
    </Card>
  );
}
