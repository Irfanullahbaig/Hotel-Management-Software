"use server";

import { z } from "zod";
import { formObject, mutate, zs } from "./util";
import { audit, BusinessError } from "@/server/services/common";
import { changeHousekeepingStatus, setRoomStatus } from "@/server/services/rooms";
import type { ActionState } from "./types";

export async function assignTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return mutate("housekeeping.edit", async (tx, ctx) => {
    const d = z.object({ taskId: zs.req("Task"), assigneeId: zs.str }).parse(formObject(fd));
    const task = await tx.housekeepingTask.findFirstOrThrow({ where: { id: d.taskId, propertyId: ctx.property.id }, include: { room: true } });
    if (["COMPLETED", "INSPECTED", "CANCELLED"].includes(task.status)) throw new BusinessError("This task is already finished.");
    if (d.assigneeId) {
      const ok = await tx.userProperty.findFirst({ where: { userId: d.assigneeId, propertyId: ctx.property.id, user: { status: "ACTIVE" } } });
      if (!ok) throw new BusinessError("That staff member does not work at this property.");
    }
    await tx.housekeepingTask.update({ where: { id: task.id }, data: { assigneeId: d.assigneeId ?? null, status: d.assigneeId ? (task.status === "PENDING" ? "ASSIGNED" : task.status) : "PENDING" } });
    if (d.assigneeId && task.room.housekeepingStatus === "DIRTY") await setRoomStatus(tx, ctx.actor, task.roomId, { housekeepingStatus: "CLEANING_ASSIGNED" }, "Cleaning assigned");
    if (d.assigneeId) await tx.notification.create({ data: { propertyId: ctx.property.id, userId: d.assigneeId, type: "HOUSEKEEPING_ASSIGNMENT", title: `Clean room ${task.room.number}`, link: "/housekeeping" } });
    await audit(tx, ctx.actor, "housekeeping.assign", "HousekeepingTask", task.id, `Room ${task.room.number} task ${d.assigneeId ? "assigned" : "unassigned"}`);
    return { ok: true, message: "Task updated." };
  });
}

export async function taskProgressAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const step = String(fd.get("step"));
  return mutate(step === "inspect" || step === "fail" ? "rooms.change_status" : "housekeeping.edit", async (tx, ctx) => {
    const d = z.object({ taskId: zs.req("Task"), step: z.enum(["start", "complete", "inspect", "fail"]), notes: zs.str }).parse(formObject(fd));
    const task = await tx.housekeepingTask.findFirstOrThrow({ where: { id: d.taskId, propertyId: ctx.property.id } });
    if (d.notes) await tx.housekeepingTask.update({ where: { id: task.id }, data: { notes: [task.notes, d.notes].filter(Boolean).join("\n") } });
    const to = { start: "CLEANING_IN_PROGRESS", complete: "CLEAN", inspect: "INSPECTED", fail: "DIRTY" } as const;
    if (d.step === "fail") {
      await changeHousekeepingStatus(tx, ctx.actor, task.roomId, "DIRTY", "Failed inspection");
      await tx.housekeepingTask.update({ where: { id: task.id }, data: { status: task.assigneeId ? "ASSIGNED" : "PENDING", completedAt: null } });
      if (task.assigneeId) await setRoomStatus(tx, ctx.actor, task.roomId, { housekeepingStatus: "CLEANING_ASSIGNED" }, "Re-clean after failed inspection");
      return { ok: true, message: "Sent back for re-cleaning." };
    }
    await changeHousekeepingStatus(tx, ctx.actor, task.roomId, to[d.step]);
    return { ok: true, message: d.step === "inspect" ? "Room inspected and ready to sell." : "Task updated." };
  });
}
