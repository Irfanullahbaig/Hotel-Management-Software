import { prisma } from "@/lib/db";
import { pageAuth } from "@/server/auth/page";
import { Forbidden } from "@/components/ui/layout";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { UserForm } from "@/components/settings/forms";

export default async function NewUserPage() {
  const ctx = await pageAuth("users.create");
  if (!ctx) return <Forbidden />;
  const roles = await prisma.role.findMany({ where: { organizationId: ctx.user.organizationId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
  return (
    <Card><CardHeader title="New user" /><CardBody>
      <UserForm user={{ roleIds: [], propertyIds: [ctx.property.id] }} roles={roles} properties={ctx.properties} canGrantSuper={ctx.user.isSuperAdmin} />
    </CardBody></Card>
  );
}
