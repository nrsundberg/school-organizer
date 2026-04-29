import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import wordmark from "/logo-wordmark.svg?url";
import { DEFAULT_SITE_NAME } from "~/lib/site";
import LanguageSwitcher from "~/components/LanguageSwitcher";

type HeaderBranding = {
  orgName?: string;
  primaryColor?: string;
  logoUrl?: string | null;
};

// WCAG-style luminance check: pick black on light backgrounds, white on dark.
// Threshold ≈ 0.179 is where contrast vs black equals contrast vs white.
function contrastForeground(hex: string): "dark" | "light" {
  const cleaned = hex.trim().replace(/^#/, "");
  const expanded =
    cleaned.length === 3
      ? cleaned.split("").map((c) => c + c).join("")
      : cleaned;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "dark";
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(expanded.slice(0, 2), 16));
  const g = toLin(parseInt(expanded.slice(2, 4), 16));
  const b = toLin(parseInt(expanded.slice(4, 6), 16));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? "dark" : "light";
}

export default function ({
  user,
  branding,
}: {
  user: boolean;
  branding?: HeaderBranding;
}) {
  const { t } = useTranslation("common");
  const orgName = branding?.orgName ?? DEFAULT_SITE_NAME;
  const headerColor = branding?.primaryColor ?? "#60A5FA";
  const tone = contrastForeground(headerColor);
  const fgText = tone === "dark" ? "text-black" : "text-white";
  const fgBorder = tone === "dark" ? "border-black" : "border-white";
  const linkClass = `border-1 ${fgBorder} p-1 rounded-lg ${fgText}`;
  // Tenants that upload their own logo should still see it. Fall back to the
  // PickupRoster horizontal wordmark otherwise.
  const tenantLogo = branding?.logoUrl && branding.logoUrl !== "/logo-icon.svg"
    ? branding.logoUrl
    : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return user ? (
    <div className="h-10 w-full flex items-center justify-center" style={{ backgroundColor: headerColor }}>
      <Link to="/" className={`${fgText} font-bold inline-flex items-center`}>
        {tenantLogo ? (
          <>
            <img src={tenantLogo} alt={t("header.logoAlt", { orgName })} height={40} width={40} />
            {t("header.tenantTitle", { orgName })}
          </>
        ) : (
          <img src={wordmark} alt={t("header.wordmarkAlt")} height={32} className="h-8 w-auto" />
        )}
      </Link>
      <div className="hidden md:inline-flex gap-2 absolute right-2 items-center">
        <LanguageSwitcher placement="compact" tone={tone} />
        <Link className={linkClass} to="/admin">
          {t("header.admin")}
        </Link>
        <Link className={linkClass} to="/admin/profile">
          {t("header.profile")}
        </Link>
      </div>
      <div className="md:hidden absolute right-2 inset-y-0 flex items-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label={t("header.menu")}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((v) => !v)}
          className={`${linkClass} inline-flex items-center`}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            className={`absolute right-0 top-full mt-1 flex flex-col gap-2 p-2 rounded-lg border-1 ${fgBorder} z-50 min-w-[10rem]`}
            style={{ backgroundColor: headerColor }}
          >
            <div onClick={closeMenu}>
              <LanguageSwitcher placement="compact" tone={tone} />
            </div>
            <Link
              className={`${linkClass} text-center`}
              to="/admin"
              onClick={closeMenu}
            >
              {t("header.admin")}
            </Link>
            <Link
              className={`${linkClass} text-center`}
              to="/admin/profile"
              onClick={closeMenu}
            >
              {t("header.profile")}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="h-10 w-full flex items-center justify-center" style={{ backgroundColor: headerColor }}>
      <Link to="/" className={`${fgText} font-bold inline-flex items-center`}>
        {tenantLogo ? (
          <>
            <img src={tenantLogo} alt={t("header.logoAlt", { orgName })} height={40} width={40} />
            {t("header.tenantTitle", { orgName })}
          </>
        ) : (
          <img src={wordmark} alt={t("header.wordmarkAlt")} height={32} className="h-8 w-auto" />
        )}
      </Link>
      <div className="hidden md:inline-flex gap-2 absolute right-2 items-center">
        <LanguageSwitcher placement="compact" tone={tone} />
        <Link className={linkClass} to="/login">
          {t("header.login")}
        </Link>
      </div>
      <div className="md:hidden absolute right-2 inset-y-0 flex items-center">
        <button
          ref={buttonRef}
          type="button"
          aria-label={t("header.menu")}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((v) => !v)}
          className={`${linkClass} inline-flex items-center`}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            className={`absolute right-0 top-full mt-1 flex flex-col gap-2 p-2 rounded-lg border-1 ${fgBorder} z-50 min-w-[10rem]`}
            style={{ backgroundColor: headerColor }}
          >
            <div onClick={closeMenu}>
              <LanguageSwitcher placement="compact" tone={tone} />
            </div>
            <Link
              className={`${linkClass} text-center`}
              to="/login"
              onClick={closeMenu}
            >
              {t("header.login")}
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
