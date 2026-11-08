import { requireAuth } from "@/server/auth/context";
import { PageHeader } from "@/components/ui/layout";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/settings/forms";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const ctx = await requireAuth();
  const first = (await searchParams).first;
  return (
    <>
      <PageHeader title="My account" />
      {first && <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">Please choose a new password before you continue.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Profile" /><CardBody><DescriptionList items={[["Name", ctx.user.name], ["Email", ctx.user.email], ["Roles", ctx.user.isSuperAdmin ? "Super Admin" : ctx.roles.join(", ")], ["Properties", ctx.properties.map((p) => p.name).join(", ")]]} /></CardBody></Card>
        <Card><CardHeader title="Change password" /><CardBody><ChangePasswordForm /></CardBody></Card>
      </div>
    </>
  );
}
