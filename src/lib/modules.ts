/**
 * Module switch. Modules listed here are fully built but shown as "Pending"
 * until they are turned on. Front desk, rooms, reservations, guests,
 * housekeeping, dashboard, Staff & HR, payroll and settings are always on.
 *
 * Turn modules on with the HMS_ENABLED_MODULES environment variable:
 *   HMS_ENABLED_MODULES=all                     every module
 *   HMS_ENABLED_MODULES=restaurant,inventory    just these
 * Nothing is deleted: a pending module's pages, data and permissions stay in place.
 * This file is imported by the edge middleware, so it must not import server code.
 */
export const SWITCHABLE_MODULES = {
  group: { label: "Group Overview", paths: ["/group"] },
  maintenance: { label: "Maintenance", paths: ["/maintenance"] },
  restaurant: { label: "Restaurant & POS", paths: ["/restaurant"] },
  services: { label: "Services", paths: ["/services"] },
  events: { label: "Events", paths: ["/events"] },
  finance: { label: "Finance & Accounting", paths: ["/finance"] },
  inventory: { label: "Inventory", paths: ["/inventory"] },
  procurement: { label: "Procurement", paths: ["/procurement"] },
  sales: { label: "Sales & Marketing", paths: ["/sales"] },
  reports: { label: "Reports", paths: ["/reports", "/api/reports"] },
  booking: { label: "Online booking", paths: ["/book", "/api/public"] },
} as const;

export type SwitchableModule = keyof typeof SWITCHABLE_MODULES;

function enabledSet(): Set<string> | "all" {
  const raw = (process.env.HMS_ENABLED_MODULES ?? "").trim().toLowerCase();
  if (raw === "all") return "all";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export function isModuleEnabled(key: SwitchableModule): boolean {
  const on = enabledSet();
  return on === "all" || on.has(key);
}

const matches = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + "/");

/** The pending module a path belongs to, or null when the path is live. */
export function pendingModuleFor(pathname: string): SwitchableModule | null {
  for (const [key, m] of Object.entries(SWITCHABLE_MODULES) as [SwitchableModule, (typeof SWITCHABLE_MODULES)[SwitchableModule]][]) {
    if (m.paths.some((p) => matches(pathname, p))) return isModuleEnabled(key) ? null : key;
  }
  return null;
}
