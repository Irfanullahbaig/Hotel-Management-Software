/**
 * Permission catalogue and default role grants.
 * Codes are `module.action`. The seed writes these to the database; custom
 * roles created in Settings → Roles combine the same codes.
 */
export const MODULES = {
  dashboard: "Dashboard",
  reservations: "Reservations",
  frontdesk: "Front Desk",
  rooms: "Rooms",
  guests: "Guests",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  restaurant: "Restaurant & POS",
  services: "Services",
  events: "Events",
  hr: "Staff & HR",
  payroll: "Payroll",
  finance: "Finance & Accounting",
  inventory: "Inventory",
  procurement: "Procurement",
  sales: "Sales & Marketing",
  reports: "Reports",
  notifications: "Notifications",
  settings: "Settings",
  users: "Users",
  roles: "Roles",
  audit: "Audit Log",
} as const;

export type ModuleKey = keyof typeof MODULES;
export const STANDARD_ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;

/** Extra, module-specific permissions beyond the standard six. */
export const SPECIAL_PERMISSIONS: Record<string, string> = {
  "guests.view_sensitive": "View guest identification documents",
  "finance.view_sensitive": "View financial figures and balances",
  "reservations.cancel": "Cancel reservations",
  "reservations.override_rate": "Override room rates and apply discounts",
  "frontdesk.checkin": "Check guests in",
  "frontdesk.checkout": "Check guests out",
  "frontdesk.payment": "Record guest payments and refunds",
  "frontdesk.night_audit": "Run night audit (post room charges)",
  "frontdesk.allow_balance": "Check out with an outstanding balance",
  "rooms.change_status": "Change room housekeeping and service status",
  "users.manage_sessions": "View and revoke user sessions",
};

export function allPermissionCodes(): { code: string; module: string; action: string; description: string }[] {
  const out: { code: string; module: string; action: string; description: string }[] = [];
  for (const [module, label] of Object.entries(MODULES)) {
    for (const action of STANDARD_ACTIONS) {
      out.push({ code: `${module}.${action}`, module, action, description: `${action[0].toUpperCase()}${action.slice(1)} ${label}` });
    }
  }
  for (const [code, description] of Object.entries(SPECIAL_PERMISSIONS)) {
    const [module, action] = code.split(".");
    out.push({ code, module, action, description });
  }
  return out;
}

const all = (m: ModuleKey) => STANDARD_ACTIONS.map((a) => `${m}.${a}`);
const view = (...ms: ModuleKey[]) => ms.map((m) => `${m}.view`);
const crud = (m: ModuleKey) => [`${m}.view`, `${m}.create`, `${m}.edit`];

const FRONT_OFFICE = [
  ...crud("reservations"), ...crud("guests"), "frontdesk.view", "frontdesk.checkin", "frontdesk.checkout",
  "frontdesk.payment", "rooms.view", "dashboard.view", "notifications.view",
];

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: string[] | "*" }[] = [
  { key: "super_admin", name: "Super Admin", description: "Full access to every property and setting", permissions: "*" },
  {
    key: "hotel_owner", name: "Hotel Owner", description: "Views and approves everything; no day-to-day edits",
    permissions: [
      ...Object.keys(MODULES).flatMap((m) => [`${m}.view`, `${m}.export`]),
      "finance.approve", "payroll.approve", "procurement.approve", "finance.view_sensitive", "guests.view_sensitive",
    ],
  },
  {
    key: "general_manager", name: "General Manager", description: "Runs all hotel operations",
    permissions: [
      ...all("reservations"), ...all("frontdesk"), ...all("rooms"), ...all("guests"), ...all("housekeeping"),
      ...all("maintenance"), ...all("restaurant"), ...all("services"), ...all("events"), ...all("sales"),
      ...all("reports"), "dashboard.view", "finance.view", "finance.export", "finance.approve", "finance.view_sensitive",
      "hr.view", "payroll.view", "payroll.approve", "inventory.view", "procurement.view", "procurement.approve",
      "users.view", "audit.view", "notifications.view", "settings.view",
      ...Object.keys(SPECIAL_PERMISSIONS).filter((c) => !c.startsWith("users.")),
    ],
  },
  {
    key: "hotel_admin", name: "Hotel Administrator", description: "Configures the hotel, users and rooms",
    permissions: [
      ...all("settings"), ...all("users"), ...all("roles"), ...all("rooms"), "rooms.change_status", "audit.view",
      "users.manage_sessions", "dashboard.view", ...view("reservations", "frontdesk", "guests", "housekeeping", "maintenance", "reports", "notifications"),
    ],
  },
  {
    key: "front_desk_manager", name: "Front Desk Manager", description: "Leads reception and reservations",
    permissions: [
      ...FRONT_OFFICE, ...all("reservations"), ...all("guests"), ...all("frontdesk"), "rooms.edit", "rooms.change_status",
      "reservations.cancel", "reservations.override_rate", "guests.view_sensitive", "frontdesk.night_audit",
      "frontdesk.allow_balance", "finance.view_sensitive", "housekeeping.view", "reports.view", "reports.export",
    ],
  },
  { key: "receptionist", name: "Receptionist", description: "Bookings, check-in and check-out", permissions: [...FRONT_OFFICE, "guests.view_sensitive", "housekeeping.view"] },
  {
    key: "cashier", name: "Cashier", description: "Takes guest payments",
    permissions: ["dashboard.view", "frontdesk.view", "frontdesk.payment", "reservations.view", "guests.view", "finance.view", "finance.create", "notifications.view"],
  },
  {
    key: "accountant", name: "Accountant", description: "Maintains the books",
    permissions: [...all("finance").filter((c) => c !== "finance.approve"), "finance.view_sensitive", ...view("reports", "reservations", "guests", "frontdesk", "dashboard", "payroll", "procurement"), "reports.export"],
  },
  {
    key: "auditor", name: "Auditor", description: "Read-only access to finance and audit trail",
    permissions: [...view("finance", "reports", "audit", "reservations", "frontdesk", "dashboard", "payroll", "procurement", "inventory"), "finance.export", "reports.export", "finance.view_sensitive"],
  },
  { key: "hr_manager", name: "HR Manager", description: "Employees, attendance, leave and payroll", permissions: [...all("hr"), ...crud("payroll"), "dashboard.view", "reports.view", "notifications.view"] },
  {
    key: "housekeeping_manager", name: "Housekeeping Manager", description: "Runs housekeeping",
    permissions: [...all("housekeeping"), "rooms.view", "rooms.change_status", "maintenance.view", "maintenance.create", "dashboard.view", "inventory.view", "notifications.view"],
  },
  { key: "housekeeping_staff", name: "Housekeeping Staff", description: "Cleans assigned rooms", permissions: ["housekeeping.view", "housekeeping.edit", "rooms.view", "maintenance.create", "dashboard.view", "notifications.view"] },
  { key: "maintenance_manager", name: "Maintenance Manager", description: "Repairs and preventive maintenance", permissions: [...all("maintenance"), "rooms.view", "rooms.change_status", "dashboard.view", "inventory.view", "notifications.view"] },
  { key: "restaurant_manager", name: "Restaurant Manager", description: "Restaurant, menus and POS", permissions: [...all("restaurant"), "inventory.view", "guests.view", "dashboard.view", "reports.view", "notifications.view"] },
  { key: "kitchen_staff", name: "Kitchen Staff", description: "Kitchen tickets", permissions: ["restaurant.view", "restaurant.edit", "dashboard.view"] },
  { key: "inventory_manager", name: "Inventory Manager", description: "Stock and stores", permissions: [...all("inventory"), "procurement.view", "procurement.create", "dashboard.view", "notifications.view"] },
  { key: "procurement_officer", name: "Procurement Officer", description: "Suppliers and purchasing", permissions: [...all("procurement").filter((c) => c !== "procurement.approve"), "inventory.view", "dashboard.view", "notifications.view"] },
  { key: "sales_manager", name: "Sales & Marketing Manager", description: "Rates, promotions and CRM", permissions: [...all("sales"), "guests.view", "guests.edit", "reservations.view", "rooms.view", "reports.view", "reports.export", "dashboard.view"] },
  { key: "security_staff", name: "Security Staff", description: "In-house guest list", permissions: ["frontdesk.view", "guests.view", "rooms.view", "dashboard.view"] },
];
