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
      <Link to="/" className="text-black font-bold inline-flex items-center">
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
        <LanguageSwitcher placement="compact" />
        <Link
          className="border-1 border-black p-1 rounded-lg text-black"
          to="/admin"
        >
          {t("header.admin")}
        </Link>
        <Link
          className="border-1 border-black p-1 rounded-lg text-black"
          to="/admin/profile"
        >
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
          className="border-1 border-black p-1 rounded-lg text-black inline-flex items-center"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            className="absolute right-0 top-full mt-1 flex flex-col gap-2 p-2 rounded-lg border-1 border-black z-50 min-w-[10rem]"
            style={{ backgroundColor: headerColor }}
          >
            <div onClick={closeMenu}>
              <LanguageSwitcher placement="compact" />
            </div>
            <Link
              className="border-1 border-black p-1 rounded-lg text-black text-center"
              to="/admin"
              onClick={closeMenu}
            >
              {t("header.admin")}
            </Link>
            <Link
              className="border-1 border-black p-1 rounded-lg text-black text-center"
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
      <Link to="/" className="text-black font-bold inline-flex items-center">
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
        <LanguageSwitcher placement="compact" />
        <Link
          className="border-1 border-black p-1 rounded-lg text-black"
          to="/login"
        >
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
          className="border-1 border-black p-1 rounded-lg text-black inline-flex items-center"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            className="absolute right-0 top-full mt-1 flex flex-col gap-2 p-2 rounded-lg border-1 border-black z-50 min-w-[10rem]"
            style={{ backgroundColor: headerColor }}
          >
            <div onClick={closeMenu}>
              <LanguageSwitcher placement="compact" />
            </div>
            <Link
              className="border-1 border-black p-1 rounded-lg text-black text-center"
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
