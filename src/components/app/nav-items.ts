import { BarChart3, Gauge, LayoutDashboard, ListChecks, Settings, Users } from "lucide-react";

export type NavFlags = { isAdmin: boolean; hasSalesperson: boolean };

export function navItems({ isAdmin, hasSalesperson }: NavFlags) {
  return [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard, show: isAdmin },
    { href: "/my-dashboard", label: "My Dashboard", icon: Gauge, show: hasSalesperson },
    { href: "/opportunities", label: "Opportunities", icon: ListChecks, show: isAdmin || hasSalesperson },
    { href: "/salespeople", label: "Salespeople", icon: Users, show: isAdmin },
    { href: "/analytics", label: "Analytics", icon: BarChart3, show: isAdmin },
    { href: "/settings", label: "Settings", icon: Settings, show: isAdmin },
  ].filter((i) => i.show);
}
