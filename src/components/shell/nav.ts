export type NavItem = { href: string; label: string; icon: string; permission: string; phase?: number };

/** Sidebar order follows the product spec. `phase` marks modules not yet shipped. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard.view" },
  { href: "/group", label: "Group Overview", icon: "Building2", permission: "reports.view" },
  { href: "/reservations", label: "Reservations", icon: "CalendarDays", permission: "reservations.view" },
  { href: "/frontdesk", label: "Front Desk", icon: "ConciergeBell", permission: "frontdesk.view" },
  { href: "/rooms", label: "Rooms", icon: "BedDouble", permission: "rooms.view" },
  { href: "/guests", label: "Guests", icon: "Users", permission: "guests.view" },
  { href: "/housekeeping", label: "Housekeeping", icon: "Sparkles", permission: "housekeeping.view" },
  { href: "/maintenance", label: "Maintenance", icon: "Wrench", permission: "maintenance.view"},
  { href: "/restaurant", label: "Restaurant & POS", icon: "UtensilsCrossed", permission: "restaurant.view"},
  { href: "/services", label: "Services", icon: "HandPlatter", permission: "services.view"},
  { href: "/events", label: "Events", icon: "PartyPopper", permission: "events.view"},
  { href: "/hr", label: "Staff & HR", icon: "IdCard", permission: "hr.view" },
  { href: "/payroll", label: "Payroll", icon: "Wallet", permission: "payroll.view" },
  { href: "/finance", label: "Finance & Accounting", icon: "Landmark", permission: "finance.view" },
  { href: "/inventory", label: "Inventory", icon: "Boxes", permission: "inventory.view"},
  { href: "/procurement", label: "Procurement", icon: "ShoppingCart", permission: "procurement.view"},
  { href: "/sales", label: "Sales & Marketing", icon: "Megaphone", permission: "sales.view"},
  { href: "/reports", label: "Reports", icon: "FileBarChart", permission: "reports.view"},
  { href: "/my-time", label: "My Time & Leave", icon: "Clock", permission: "dashboard.view" },
  { href: "/notifications", label: "Notifications", icon: "Bell", permission: "notifications.view" },
  { href: "/settings", label: "Settings", icon: "Settings", permission: "settings.view" },
];
