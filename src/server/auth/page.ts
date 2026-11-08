import "server-only";
import { businessToday } from "@/lib/dates";
import { can, requireProperty } from "./context";

/** For server pages: returns the context, or null when the user lacks the permission (render <Forbidden/>). */
export async function pageAuth(permission: string) {
  const ctx = await requireProperty();
  if (!can(ctx, permission)) return null;
  return { ...ctx, today: businessToday(ctx.property.timeZone), can: (p: string) => can(ctx, p) };
}
