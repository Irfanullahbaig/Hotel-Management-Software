import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { pageAuth } from "@/server/auth/page";
import { MODULES, allPermissionCodes } from "@/server/auth/permissions";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DeleteRoleButton, RoleForm } from "@/components/settings/forms";

export const dynamic = "force-dynamic";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageAuth("roles.view");
  if (!ctx) return <Forbidden />;
  const { id } = await params;
  const isNew = id === "new";
  if (isNew && !ctx.can("roles.create")) return <Forbidden />;
  const role = isNew ? null : await prisma.role.findFirst({ where: { id, organizationId: ctx.user.organizationId }, include: { permissions: { include: { permission: true } } } });
  if (!isNew && !role) notFound();
  const all = allPermissionCodes();
  const groups = Object.entries(MODULES).map(([module, label]) => ({ module, label, perms: all.filter((p) => p.module === module).map(({ code, action, description }) => ({ code, action, description })) }));
  const locked = !ctx.can("roles.edit") || role?.key === "super_admin";
  return (
    <Card>
      <CardHeader title={role ? role.name : "New role"} description={role?.key === "super_admin" ? "Super Admin always has every permission and cannot be edited." : "Tick what this role may do in each module. Financial figures need Finance → view or 'View financial figures'."} actions={role && !role.isSystem && ctx.can("roles.delete") ? <DeleteRoleButton id={role.id} /> : undefined} />
      <CardBody>
        <RoleForm role={role ?? undefined} groups={groups} granted={role?.key === "super_admin" ? all.map((p) => p.code) : role?.permissions.map((p) => p.permission.code) ?? []} locked={locked} />
      </CardBody>
    </Card>
  );
}
