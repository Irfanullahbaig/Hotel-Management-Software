import { cn } from "@/lib/utils";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-muted text-ink-2 ring-border",
  ok: "bg-ok-soft text-ok ring-ok/20",
  warn: "bg-warn-soft text-warn ring-warn/20",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
  brand: "bg-brand-soft text-brand ring-brand/20",
  violet: "bg-violet-soft text-violet ring-violet/20",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  AVAILABLE: "ok", INSPECTED: "ok", CONFIRMED: "info", RESERVED: "info", OCCUPIED: "brand", CHECKED_IN: "brand",
  DIRTY: "danger", CLEANING_ASSIGNED: "warn", CLEANING_IN_PROGRESS: "warn", CLEAN: "violet", PENDING: "warn",
  OUT_OF_SERVICE: "neutral", UNDER_MAINTENANCE: "neutral", BLOCKED: "neutral", CHECKED_OUT: "neutral",
  CANCELLED: "danger", NO_SHOW: "danger", OPEN: "info", CLOSED: "neutral", ACTIVE: "ok", INACTIVE: "neutral", LOCKED: "danger",
  ASSIGNED: "info", IN_PROGRESS: "warn", COMPLETED: "violet", HIGH: "warn", URGENT: "danger", NORMAL: "neutral", LOW: "neutral",
  APPROVED: "ok", REJECTED: "danger", PRESENT: "ok", LATE: "warn", HALF_DAY: "warn", ABSENT: "danger", ON_LEAVE: "info", DAY_OFF: "neutral",
  DRAFT: "neutral", PAID: "ok", SUSPENDED: "warn", TERMINATED: "neutral",
  STORED: "info", RETURNED: "ok", DISPOSED: "neutral", REQUESTED: "warn", DELIVERED: "ok", SETTLED: "ok", VOID: "danger",
  NEW: "danger", PREPARING: "warn", READY: "ok", SERVED: "neutral", SUBMITTED: "info", PARTIALLY_RECEIVED: "warn", RECEIVED: "ok",
  PARTIALLY_PAID: "warn", TENTATIVE: "warn", SENT: "ok", RESOLVED: "ok", NOT_CONFIGURED: "warn", SUCCESS: "ok", FAILED: "danger", ORDERED: "violet",
  COMPLAINT: "danger", FEEDBACK: "info", EARN: "ok", REDEEM: "violet", ADJUST: "neutral", RECEIPT: "ok", ISSUE: "warn", TRANSFER: "info", ADJUSTMENT: "neutral",
};
const LABELS: Record<string, string> = { CLEAN: "Inspection pending", COMPLETED: "Cleaned", INSPECTED: "Inspected", TERMINATED: "Left" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = LABELS[status] ?? status.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  return <Badge tone={STATUS_TONES[status] ?? "neutral"} className={className}>{label}</Badge>;
}
