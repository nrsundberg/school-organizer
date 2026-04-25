/**
 * LanguageSwitcher
 *
 * Globe icon + native-name dropdown that lets the visitor change the UI
 * language. Wired everywhere a header is shown — `Header.tsx` for
 * authenticated chrome, `MobileCallerView.tsx` for the public/caller view.
 *
 * Behavior (decided in the i18n plan, see docs/i18n-contract.md):
 *
 *  - Trigger is at least 44px tall (mobile tap-target rule).
 *  - Trigger label is the *current* language's native name ("English",
 *    "Español"). No flags — flags map poorly to languages.
 *  - Each option carries a `lang={code}` attribute so screen readers pick
 *    up the language switch even before the page reloads.
 *  - Selecting an option:
 *      1. Writes the `lng` cookie immediately (1 year, SameSite=Lax,
 *         Path=/), so even non-logged-in visitors get persistence.
 *      2. If a user is logged in, POSTs the locale to `/api/user-prefs`
 *         and waits for the response before reloading — this keeps
 *         `User.locale` in sync with the cookie. We reload (rather than
 *         calling `i18n.changeLanguage`) because lots of strings are
 *         server-rendered (toast copy, error pages, redirects), and a
 *         reload guarantees they all flip together.
 *
 * The component is a default export with no required props (mounted as
 * `<LanguageSwitcher />`). It reads the active locale via
 * `useTranslation().i18n.language` so it stays in lock-step with the
 * remix-i18next-driven loader value.
 */

import { useTranslation } from "react-i18next";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  SUPPORTED_LANGUAGES,
  LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  pickSupportedLanguage,
  type SupportedLanguage,
} from "~/lib/i18n-config";

export interface LanguageSwitcherProps {
  /**
   * Sizing variant. `"header"` (default) is the inline-with-header chrome
   * size. `"compact"` shrinks the trigger and hides the chevron — useful
   * inside a tight footer or mobile drawer. Phase 2 can extend this set.
   */
  placement?: "header" | "compact";
}

export default function LanguageSwitcher({
  placement = "header",
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation("common");
  const current: SupportedLanguage = pickSupportedLanguage(i18n.language);
  const currentMeta =
    SUPPORTED_LANGUAGES.find((l) => l.code === current) ?? SUPPORTED_LANGUAGES[0];

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SupportedLanguage | null>(null);

  const compact = placement === "compact";

  async function pick(code: SupportedLanguage) {
    if (code === current || pending) {
      setOpen(false);
      return;
    }
    setPending(code);

    // 1. Cookie first — covers anonymous visitors and is the source of truth
    //    for the server-side detector chain on the next request.
    document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(code)}; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;

    // 2. If logged in, persist to User.locale. We send JSON (the API route
    //    accepts both JSON and form-data); failures are non-fatal — the
    //    cookie still wins on the next render.
    try {
      const res = await fetch("/api/user-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: code }),
      });
      // We don't throw on !res.ok — if the user isn't logged in the route
      // returns 403 and that's fine.
      void res;
    } catch {
      // Network blip — the cookie still applies.
    }

    // 3. Reload so server-rendered strings flip with the client. Loaders
    //    re-run with the new cookie present and pick the new locale.
    window.location.reload();
  }

  // Trigger sizing: HeroUI Button at default `md` is ~40px; we bump padding
  // so the hit area is >= 44px on touch devices (WCAG 2.5.5 Target Size AAA).
  const triggerClass = compact
    ? "min-h-[40px] px-2 gap-1"
    : "min-h-[44px] px-3 gap-2";

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <Button
          variant="ghost"
          aria-label={t("languageSwitcher.ariaLabel", "Change language")}
          className={triggerClass}
          isDisabled={pending !== null}
        >
          <Globe size={compact ? 16 : 18} aria-hidden="true" />
          <span lang={currentMeta.code}>{currentMeta.nativeName}</span>
          {!compact && (
            <ChevronDown size={14} aria-hidden="true" className="opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent placement="bottom end">
        <ul
          role="listbox"
          aria-label={t("languageSwitcher.label", "Language")}
          className="min-w-[180px] py-1"
        >
          {SUPPORTED_LANGUAGES.map((lng) => {
            const isCurrent = lng.code === current;
            const isPending = pending === lng.code;
            return (
              <li key={lng.code} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  lang={lng.code}
                  onClick={() => pick(lng.code)}
                  disabled={pending !== null}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left min-h-[44px] hover:bg-default-100 focus:bg-default-100 focus:outline-none disabled:opacity-50"
                >
                  <span>{lng.nativeName}</span>
                  {(isCurrent || isPending) && (
                    <Check
                      size={16}
                      aria-hidden="true"
                      className={isPending ? "animate-pulse" : ""}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
