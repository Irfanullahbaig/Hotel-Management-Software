import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ResetPasswordDialog, RevokeSessionButton, UserForm } from "@/components/settings/forms";

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("users.view");
  if (!ctx) return <Forbidden />;
  const u = await prisma.user.findFirst({ where: { id: (await params).id, organizationId: ctx.user.organizationId }, include: { roles: true, properties: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } } } });
  if (!u) notFound();
  const [roles, activity] = await Promise.all([
    prisma.role.findMany({ where: { organizationId: ctx.user.organizationId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    prisma.auditLog.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const allProps = ctx.user.isSuperAdmin ? await prisma.property.findMany({ where: { organizationId: ctx.user.organizationId } }) : ctx.properties;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={u.name} description={u.email} actions={ctx.can("users.edit") ? <ResetPasswordDialog id={u.id} /> : undefined} />
        <CardBody>
          <UserForm canGrantSuper={ctx.user.isSuperAdmin} roles={roles} properties={allProps.map((p) => ({ id: p.id, name: p.name }))}
            user={{ id: u.id, name: u.name, email: u.email, phone: u.phone, department: u.department, status: u.status, roleIds: u.roles.filter((r) => !r.propertyId).map((r) => r.roleId), propertyIds: u.properties.map((p) => p.propertyId) }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Active sessions" />
        {u.sessions.length ? (
          <Table><THead><tr><TH>Started</TH><TH>Last seen</TH><TH>IP</TH><TH>Device</TH><TH /></tr></THead>
            <TBody>{u.sessions.map((s) => <TR key={s.id}><TD className="text-xs">{formatDateTime(s.createdAt, ctx.property.timeZone)}</TD><TD className="text-xs">{formatDateTime(s.lastSeenAt, ctx.property.timeZone)}</TD><TD className="text-xs">{s.ip}</TD><TD className="max-w-xs truncate text-xs text-ink-3">{s.userAgent}</TD><TD className="text-right">{ctx.can("users.manage_sessions") && <RevokeSessionButton id={s.id} />}</TD></TR>)}</TBody>
          </Table>
        ) : <CardBody className="text-sm text-ink-3">Not signed in anywhere.</CardBody>}
      </Card>
      <Card>
        <CardHeader title="Recent activity" />
        {activity.length ? (
          <Table><THead><tr><TH>When</TH><TH>Action</TH><TH>Summary</TH></tr></THead>
            <TBody>{activity.map((a) => <TR key={a.id}><TD className="text-xs whitespace-nowrap">{formatDateTime(a.createdAt, ctx.property.timeZone)}</TD><TD className="font-mono text-xs">{a.action}</TD><TD className="text-sm">{a.summary}</TD></TR>)}</TBody>
          </Table>
        ) : <CardBody className="text-sm text-ink-3">No activity yet.</CardBody>}
      </Card>
    </div>
  );
}
