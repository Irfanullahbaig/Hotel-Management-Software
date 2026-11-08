import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RevokeSessionButton } from "@/components/settings/forms";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const ctx = await pageAuth("users.manage_sessions");
  if (!ctx) return <Forbidden />;
  const sessions = await prisma.session.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() }, user: { organizationId: ctx.user.organizationId } }, include: { user: true }, orderBy: { lastSeenAt: "desc" } });
  return (
    <Card>
      <CardHeader title="Active sessions" description="Sessions expire after 12 hours of inactivity. Deactivating a user or resetting a password signs them out everywhere." />
      <Table>
        <THead><tr><TH>User</TH><TH>Started</TH><TH>Last seen</TH><TH>IP</TH><TH>Device</TH><TH /></tr></THead>
        <TBody>{sessions.map((s) => (
          <TR key={s.id}><TD>{s.user.name}<div className="text-xs text-ink-3">{s.user.email}</div></TD><TD className="text-xs">{formatDateTime(s.createdAt, ctx.property.timeZone)}</TD><TD className="text-xs">{formatDateTime(s.lastSeenAt, ctx.property.timeZone)}</TD><TD className="text-xs">{s.ip}</TD><TD className="max-w-xs truncate text-xs text-ink-3">{s.userAgent}</TD><TD className="text-right">{s.id !== ctx.sessionId ? <RevokeSessionButton id={s.id} /> : <span className="text-xs text-ink-3">This session</span>}</TD></TR>
        ))}</TBody>
      </Table>
    </Card>
  );
}
