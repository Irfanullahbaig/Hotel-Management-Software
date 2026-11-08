export type NavItem = { href: string; label: string; icon: string; permission: string; phase?: number };

/** Sidebar order follows the product spec. `phase` marks modules not yet shipped. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard.view" },
  { href: "/reservations", label: "Reservations", icon: "CalendarDays", permission: "reservations.view" },
  { href: "/frontdesk", label: "Front Desk", icon: "ConciergeBell", permission: "frontdesk.view" },
  { href: "/rooms", label: "Rooms", icon: "BedDouble", permission: "rooms.view" },
  { href: "/guests", label: "Guests", icon: "Users", permission: "guests.view" },
  { href: "/housekeeping", label: "Housekeeping", icon: "Sparkles", permission: "housekeeping.view" },
  { href: "/maintenance", label: "Maintenance", icon: "Wrench", permission: "maintenance.view", phase: 2 },
  { href: "/restaurant", label: "Restaurant & POS", icon: "UtensilsCrossed", permission: "restaurant.view", phase: 2 },
  { href: "/services", label: "Services", icon: "HandPlatter", permission: "services.view", phase: 2 },
  { href: "/events", label: "Events", icon: "PartyPopper", permission: "events.view", phase: 5 },
  { href: "/hr", label: "Staff & HR", icon: "IdCard", permission: "hr.view", phase: 4 },
  { href: "/finance", label: "Finance & Accounting", icon: "Landmark", permission: "finance.view" },
  { href: "/inventory", label: "Inventory", icon: "Boxes", permission: "inventory.view", phase: 4 },
  { href: "/procurement", label: "Procurement", icon: "ShoppingCart", permission: "procurement.view", phase: 4 },
  { href: "/sales", label: "Sales & Marketing", icon: "Megaphone", permission: "sales.view", phase: 5 },
  { href: "/reports", label: "Reports", icon: "FileBarChart", permission: "reports.view", phase: 3 },
  { href: "/notifications", label: "Notifications", icon: "Bell", permission: "notifications.view" },
  { href: "/settings", label: "Settings", icon: "Settings", permission: "settings.view" },
];
