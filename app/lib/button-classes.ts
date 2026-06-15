/**
 * Shared Tailwind class strings for the drill action buttons.
 *
 * These are the exact strings that were duplicated verbatim across the live
 * drill console and the drill admin pages. Only the variants that are
 * byte-for-byte identical across call sites live here; pages with a
 * deliberately different variant (e.g. a secondary button without a disabled
 * cursor, or a danger-tinted ghost) keep that one-off string local so this
 * module never silently changes a button's rendered classes.
 */

/** Solid primary action (blue). */
export const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Bordered secondary action. */
export const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Destructive action (rose). */
export const btnDanger =
  "inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Low-emphasis ghost action (transparent until hover). */
export const btnGhost =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
