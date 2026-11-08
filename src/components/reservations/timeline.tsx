"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calendarMoveAction } from "@/server/actions/reservations";
import { cn } from "@/lib/utils";

export type TimelineRoom = { id: string; number: string; type: string; status: string };
export type TimelineBar = { lineId: string; reservationId: string; roomId: string | null; start: string; end: string; guest: string; reference: string; status: string; movable: boolean };

const DAY = 86400000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const BAR: Record<string, string> = {
  RESERVED: "bg-info-soft text-info border-info/30",
  CHECKED_IN: "bg-brand text-white border-brand",
  CHECKED_OUT: "bg-muted text-ink-3 border-border",
};

export function Timeline({ rooms, bars, start, days, canMove, today }: { rooms: TimelineRoom[]; bars: TimelineBar[]; start: string; days: number; canMove: boolean; today: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startT] = useTransition();
  const [drag, setDrag] = useState<TimelineBar | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const s0 = toDate(start);
  const dates = Array.from({ length: days }, (_, i) => new Date(s0.getTime() + i * DAY));
  const col = 44;

  const drop = (roomId: string, date: Date) => {
    if (!drag) return;
    const len = (toDate(drag.end).getTime() - toDate(drag.start).getTime()) / DAY;
    const checkIn = drag.status === "CHECKED_IN" ? drag.start : fmt(date);
    const checkOut = fmt(new Date(toDate(checkIn).getTime() + len * DAY));
    setDrag(null);
    setOver(null);
    startT(async () => {
      const res = await calendarMoveAction({ lineId: drag.lineId, roomId, checkIn, checkOut });
      setMsg(res?.ok ? { ok: true, text: `${drag.reference} moved.` } : { ok: false, text: res?.error ?? "Could not move the booking." });
      router.refresh();
    });
  };

  const unassigned = bars.filter((b) => !b.roomId);

  return (
    <div>
      {msg && <div role="status" className={cn("mb-3 rounded-md px-3 py-2 text-sm", msg.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger")}>{msg.text}</div>}
      {pending && <div className="mb-3 text-xs text-ink-3">Checking availability…</div>}
      {unassigned.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-warn/40 bg-warn-soft/40 p-2 text-xs">
          <span className="font-medium text-warn">Unassigned:</span>
          {unassigned.map((b) => (
            <span key={b.lineId} draggable={canMove && b.movable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", b.lineId); setDrag(b); }} className={cn("rounded border px-2 py-1", BAR[b.status], canMove && b.movable && "cursor-grab")}>
              {b.reference} · {b.guest} · {b.start.slice(5)}→{b.end.slice(5)}
            </span>
          ))}
          {canMove && <span className="text-ink-3">Drag onto a room row to assign.</span>}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div style={{ minWidth: 140 + days * col }}>
          <div className="sticky top-0 z-10 flex border-b border-border bg-muted/60 text-[11px] text-ink-3">
            <div className="w-[140px] shrink-0 px-3 py-2 font-medium">Room</div>
            {dates.map((d) => {
              const iso = fmt(d);
              const we = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <div key={iso} style={{ width: col }} className={cn("shrink-0 border-l border-border py-1 text-center", we && "bg-muted", iso === today && "bg-brand-soft font-semibold text-brand")}>
                  <div>{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getUTCDay()]}</div>
                  <div>{d.getUTCDate()}</div>
                </div>
              );
            })}
          </div>
          {rooms.map((room) => {
            const rowBars = bars.filter((b) => b.roomId === room.id);
            return (
              <div key={room.id} className="relative flex border-b border-border last:border-0">
                <div className="w-[140px] shrink-0 px-3 py-2">
                  <Link href={`/rooms/${room.id}`} className="text-sm font-medium hover:underline">{room.number}</Link>
                  <div className="truncate text-[11px] text-ink-3">{room.type}</div>
                </div>
                {dates.map((d) => {
                  const iso = fmt(d);
                  const key = `${room.id}:${iso}`;
                  return (
                    <div
                      key={iso}
                      style={{ width: col }}
                      onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(key); } }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={(e) => { e.preventDefault(); drop(room.id, d); }}
                      className={cn("shrink-0 border-l border-border", (d.getUTCDay() === 0 || d.getUTCDay() === 6) && "bg-muted/40", over === key && "bg-brand-soft")}
                    />
                  );
                })}
                {rowBars.map((b) => {
                  const startIdx = Math.max(0, (toDate(b.start).getTime() - s0.getTime()) / DAY);
                  const endIdx = Math.min(days, (toDate(b.end).getTime() - s0.getTime()) / DAY);
                  if (endIdx <= 0 || startIdx >= days) return null;
                  return (
                    <Link
                      key={b.lineId}
                      href={`/reservations/${b.reservationId}`}
                      draggable={canMove && b.movable}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.lineId); setDrag(b); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      title={`${b.reference} · ${b.guest} · ${b.start} → ${b.end}${canMove && b.movable ? " · drag to move" : ""}`}
                      className={cn("absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded border px-1.5 text-[11px] whitespace-nowrap shadow-xs", BAR[b.status] ?? BAR.RESERVED, canMove && b.movable ? "cursor-grab" : "cursor-pointer")}
                      style={{ left: 140 + startIdx * col + 2 + col / 2, width: (endIdx - startIdx) * col - 4 }}
                    >
                      {b.guest}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-3">
        <span className="flex items-center gap-1"><span className="size-3 rounded border border-info/30 bg-info-soft" /> Reserved</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-brand" /> In house</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded border border-border bg-muted" /> Departed</span>
        <span>Bars start mid-day on arrival and end mid-day on departure. Drag to another room or date; the server re-checks availability.</span>
      </div>
    </div>
  );
}
