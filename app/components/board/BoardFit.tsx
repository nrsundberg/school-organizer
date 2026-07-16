import { useCallback, useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2, X } from "lucide-react";

const FIT_STORAGE_KEY = "tome-board-fit";
// Below this rendered tile height the space numbers get hard to read, so we
// surface the "too small" hint offering to switch to full size. Chosen to keep
// two-digit numbers legible at the shrunk font on a phone.
const MIN_LEGIBLE_TILE_PX = 26;

/**
 * Client toggle for the board's fit-to-screen mode, persisted in localStorage
 * (mirrors the viewer-drawing persistence in `_index.tsx`). Defaults ON so the
 * board fits the viewport with no page scroll; OFF lets tiles grow to a
 * comfortable size and the grid scrolls inside the fixed frame.
 *
 * `ready` gates the first paint until the stored preference is read, avoiding a
 * flash of fit-on when the user had turned it off.
 */
export function useFitToScreen() {
  const [fitToScreen, setFitToScreen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(FIT_STORAGE_KEY) === "off") setFitToScreen(false);
    } catch {
      /* private mode / storage disabled — fall back to the default */
    }
    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    setFitToScreen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FIT_STORAGE_KEY, next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { fitToScreen, toggle, ready };
}

/**
 * Watches the rendered board and reports when tiles have shrunk below the
 * legibility threshold. Estimates tile height as containerHeight / rowCount and
 * re-measures on resize. Only meaningful while fit mode is active.
 */
export function useTilesTooSmall(
  ref: RefObject<HTMLElement | null>,
  rowCount: number,
  active: boolean,
): boolean {
  const [tooSmall, setTooSmall] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el || rowCount <= 0) {
      setTooSmall(false);
      return;
    }
    const measure = () => {
      const tile = el.clientHeight / rowCount;
      setTooSmall(tile > 0 && tile < MIN_LEGIBLE_TILE_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rowCount, active]);

  return tooSmall;
}

/**
 * Small corner button that flips fit-to-screen, plus the dismissible "tiles are
 * small" hint shown when the board is squeezed. Positioned absolutely so it
 * floats over the board without stealing grid height.
 */
export function BoardFitControls({
  fitToScreen,
  tooSmall,
  onToggle,
}: {
  fitToScreen: boolean;
  tooSmall: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("roster");
  const [hintDismissed, setHintDismissed] = useState(false);

  // Only nag while fit is on and the board is actually cramped; a fresh squeeze
  // (e.g. after a rotate) re-arms the hint.
  const showHint = fitToScreen && tooSmall && !hintDismissed;
  useEffect(() => {
    if (!tooSmall) setHintDismissed(false);
  }, [tooSmall]);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={fitToScreen}
        className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white shadow hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500]"
      >
        {fitToScreen ? (
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {fitToScreen ? t("index.fit.toFull") : t("index.fit.toFit")}
      </button>

      {showHint && (
        <div className="absolute inset-x-2 top-12 z-20 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-amber-300/40 bg-[#1a1f1f]/95 p-3 text-left text-sm text-amber-50 shadow-lg">
          <div className="flex-1">
            <p className="font-semibold text-white">{t("index.fit.hintTitle")}</p>
            <p className="mt-0.5 text-amber-100/90">{t("index.fit.hintBody")}</p>
            <button
              type="button"
              onClick={onToggle}
              className="mt-2 rounded-md bg-[#E9D500] px-2.5 py-1 text-xs font-semibold text-[#193B4B] hover:bg-[#f5e23a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t("index.fit.hintAction")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            aria-label={t("index.fit.dismiss")}
            className="text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9D500]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
