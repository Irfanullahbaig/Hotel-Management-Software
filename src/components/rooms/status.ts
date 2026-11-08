import type { DisplayStatus } from "@/server/services/rooms";

export const ROOM_STATUS_STYLE: Record<DisplayStatus, { label: string; tile: string; dot: string }> = {
  AVAILABLE: { label: "Available", tile: "border-ok/30 bg-ok-soft/60", dot: "bg-ok" },
  RESERVED: { label: "Reserved (arriving)", tile: "border-violet/30 bg-violet-soft/70", dot: "bg-violet" },
  OCCUPIED: { label: "Occupied", tile: "border-info/30 bg-info-soft", dot: "bg-info" },
  DIRTY: { label: "Dirty", tile: "border-danger/30 bg-danger-soft/70", dot: "bg-danger" },
  CLEANING_ASSIGNED: { label: "Cleaning assigned", tile: "border-warn/30 bg-warn-soft/70", dot: "bg-warn" },
  CLEANING_IN_PROGRESS: { label: "Cleaning in progress", tile: "border-warn/30 bg-warn-soft", dot: "bg-warn" },
  CLEAN: { label: "Awaiting inspection", tile: "border-warn/40 bg-surface border-dashed", dot: "bg-warn" },
  INSPECTED: { label: "Inspected", tile: "border-ok/30 bg-ok-soft/60", dot: "bg-ok" },
  OUT_OF_SERVICE: { label: "Out of service", tile: "border-border bg-muted", dot: "bg-ink-3" },
  UNDER_MAINTENANCE: { label: "Under maintenance", tile: "border-border bg-muted", dot: "bg-ink-2" },
  BLOCKED: { label: "Blocked", tile: "border-border bg-muted", dot: "bg-ink" },
};
