import {
  ClipboardList,
  CreditCard,
  Download,
  FileSpreadsheet,
  GraduationCap,
  History,
  Home,
  LayoutDashboard,
  Palette,
  Users,
} from "lucide-react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";

type NavItem = {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

const baseNavItems: NavItem[] = [
  { to: "/admin", labelKey: "sidebar.dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/users", labelKey: "sidebar.users", icon: Users },
  { to: "/admin/households", labelKey: "sidebar.households", icon: Home },
  { to: "/admin/children", labelKey: "sidebar.children", icon: GraduationCap },
  { to: "/admin/roster-import", labelKey: "sidebar.rosterImport", icon: FileSpreadsheet },
  { to: "/admin/drills", labelKey: "sidebar.drills", icon: ClipboardList },
  { to: "/admin/history", labelKey: "sidebar.history", icon: History },
  { to: "/admin/data-export", labelKey: "sidebar.dataExport", icon: Download },
  { to: "/admin/branding", labelKey: "sidebar.branding", icon: Palette },
];

const billingNavItem: NavItem = {
  to: "/admin/billing",
  labelKey: "sidebar.billing",
  icon: CreditCard,
};

export default function AdminSidebar({
  onLinkClick,
  showBilling = true,
}: {
  onLinkClick?: () => void;
  /**
   * Hidden for orgs whose billing is managed by a district. Default true so
   * non-district orgs are unaffected.
   */
  showBilling?: boolean;
}) {
  const { t } = useTranslation("admin");
  const navItems = showBilling ? [...baseNavItems, billingNavItem] : baseNavItems;
  return (
    <nav className="flex flex-col gap-1 p-4">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2 px-2">
        {t("sidebar.panelTitle")}
      </p>
      {navItems.map(({ to, labelKey, icon: Icon, end }) => (
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
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
