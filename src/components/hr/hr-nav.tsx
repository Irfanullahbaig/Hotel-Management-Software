import { Tabs } from "@/components/ui/layout";

const ITEMS = [
  { key: "employees", label: "Employees", href: "/hr" },
  { key: "attendance", label: "Attendance", href: "/hr/attendance" },
  { key: "roster", label: "Shift roster", href: "/hr/roster" },
  { key: "leave", label: "Leave", href: "/hr/leave" },
  { key: "setup", label: "Departments, shifts & leave types", href: "/hr/setup" },
] as const;

export function HrNav({ active, pendingLeave }: { active: (typeof ITEMS)[number]["key"]; pendingLeave?: number }) {
  return <Tabs active={active} items={ITEMS.map((i) => ({ ...i, count: i.key === "leave" && pendingLeave ? pendingLeave : undefined }))} />;
}
