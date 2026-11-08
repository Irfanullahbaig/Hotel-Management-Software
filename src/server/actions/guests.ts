"use server";

import { z } from "zod";
import { mutate, formObject, zs } from "./util";
import { audit, BusinessError } from "@/server/services/common";
import { can } from "@/server/auth/context";
import type { ActionState } from "./types";

const schema = z.object({
  id: zs.str,
  firstName: zs.req("First name"), lastName: zs.req("Last name"), email: zs.email, phone: zs.str, nationality: zs.str, country: zs.str,
  address: zs.str, city: zs.str, company: zs.str, preferences: zs.text, notes: zs.text, emergencyContactName: zs.str, emergencyContactPhone: zs.str,
  dateOfBirth: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()),
  category: z.enum(["REGULAR", "CORPORATE", "GROUP", "GOVERNMENT", "TRAVEL_AGENT"]),
  isVip: zs.bool, marketingConsent: zs.bool,
});

export async function saveGuestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = fd.get("id");
  return mutate(id ? "guests.edit" : "guests.create", async (tx, ctx) => {
    const { id, ...data } = schema.parse(formObject(fd));
    const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === undefined ? null : v]));
    if (data.email) {
      const dup = await tx.guest.findFirst({ where: { propertyId: ctx.property.id, email: { equals: data.email, mode: "insensitive" }, id: id ? { not: id } : undefined } });
      if (dup) throw new BusinessError(`Another guest profile (${dup.firstName} ${dup.lastName}) already uses this email.`);
    }
    const before = id ? await tx.guest.findFirstOrThrow({ where: { id, propertyId: ctx.property.id } }) : null;
    const g = id
      ? await tx.guest.update({ where: { id }, data: clean as never })
      : await tx.guest.create({ data: { ...(clean as never as object), propertyId: ctx.property.id } as never });
    await audit(tx, ctx.actor, id ? "guest.update" : "guest.create", "Guest", g.id, `${id ? "Updated" : "Created"} guest ${g.firstName} ${g.lastName}`, { before, after: g });
    return { ok: true, message: "Guest saved.", redirectTo: `/guests/${g.id}` };
  });
}

export async function addGuestDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate(["guests.edit"], async (tx, ctx) => {
    if (!can(ctx, "guests.view_sensitive")) throw new BusinessError("You are not allowed to manage identification documents.");
    const d = z.object({ guestId: zs.req("Guest"), type: zs.req("Type"), number: zs.req("Number"), issuingCountry: zs.str, expiryDate: z.preprocess((v) => (v === "" ? undefined : v), zs.date.optional()) }).parse(formObject(fd));
    await tx.guest.findFirstOrThrow({ where: { id: d.guestId, propertyId: ctx.property.id } });
    const doc = await tx.guestDocument.create({ data: d });
    await audit(tx, ctx.actor, "guest.document_add", "Guest", d.guestId, `Added ${d.type.toLowerCase()} document`, { after: { id: doc.id, type: d.type } });
    return { ok: true, message: "Document added." };
  });
}
