import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, X } from "lucide-react";

/**
 * Mobile-only collapsible for the board's homeroom filter + recent-pickups
 * list. Collapsed by default so the board owns the full viewport; opening it
 * drops an overlay panel (absolutely positioned) so it never reflows/shrinks
 * the grid underneath. Hidden at `md+`, where the desktop sidebar shows the
 * same controls beside the board.
 */
export function BoardControlsDrawer({ children }: { children: ReactNode }) {
  const { t } = useTranslation("roster");
  const [open, setOpen] = useState(false);

  return (
    <div className="relative z-30 px-4 pt-2 md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500]"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t("index.controls.toggle")}
      </button>

      {open && (
        <>
          {/* Tap-away backdrop so the panel closes without stealing board space */}
          <button
            type="button"
            aria-label={t("index.controls.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/40"
          />
          <div className="absolute inset-x-4 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-[#1a1f1f] p-4 text-left shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-white/80">
                {t("index.controls.toggle")}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("index.controls.close")}
                className="text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {children}
          </div>
        </>
      )}
    </div>
  );
}
