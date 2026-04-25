import {
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  GraduationCap,
  History,
  Home,
  LayoutDashboard,
  Palette,
  Users,
} from "lucide-react";
import { NavLink } from "react-router";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/households", label: "Households", icon: Home },
  { to: "/admin/children", label: "Children & Classes", icon: GraduationCap },
  { to: "/admin/roster-import", label: "Roster Import", icon: FileSpreadsheet },
  { to: "/admin/drills", label: "Drills", icon: ClipboardList },
  { to: "/admin/history", label: "History", icon: History },
  { to: "/admin/branding", label: "Branding", icon: Palette },
  { to: "/admin/billing", label: "Billing", icon: CreditCard },
];

export default function AdminSidebar({ onLinkClick }: { onLinkClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-4">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2 px-2">
        Admin Panel
      </p>
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onLinkClick}
          className={({ isActive }: { isActive: boolean }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-blue-600 text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`
          }
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
