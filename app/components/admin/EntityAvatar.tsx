import type { ReactNode } from "react";

/**
 * Deterministic avatar bubble used everywhere in the redesigned admin pages.
 *
 * The redesign deliberately avoids uploaded photos for students/teachers/etc
 * because schools don't reliably have them. Instead we render initials over a
 * color picked from a small palette, hashed off `colorSeed` (or `initials` if
 * no seed is provided). Same seed → same color across pages, so a teacher's
 * avatar on the children index matches their avatar on the student detail.
 */

const PALETTE = [
  // Picked to read against the page bg #212525 and panel bg #1a1f1f. The
  // bg uses a 35% alpha tint of the foreground so colors stay calm next to
  // the rest of the dark UI (no neon).
  { bg: "rgba(59,130,246,0.22)", fg: "#93c5fd" }, // blue
  { bg: "rgba(16,185,129,0.22)", fg: "#6ee7b7" }, // emerald
  { bg: "rgba(245,158,11,0.22)", fg: "#fcd34d" }, // amber
  { bg: "rgba(244,63,94,0.22)", fg: "#fda4af" }, // rose
  { bg: "rgba(6,182,212,0.22)", fg: "#67e8f9" }, // cyan
  { bg: "rgba(124,58,237,0.22)", fg: "#c4b5fd" }, // purple
  { bg: "rgba(236,72,153,0.22)", fg: "#f9a8d4" }, // pink
  { bg: "rgba(20,184,166,0.22)", fg: "#5eead4" }, // teal
] as const;

export type EntityAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_TOKENS: Record<EntityAvatarSize, { box: string; text: string }> = {
  // Tailwind v4 — keep these literal so the JIT picks them up.
  // The `box` class includes the default rounding; pass `shape="circle"`
  // to force pill-shaped avatars instead.
  xs: { box: "h-6 w-6 rounded-md", text: "text-[10px]" },
  sm: { box: "h-7 w-7 rounded-lg", text: "text-[11px]" },
  md: { box: "h-10 w-10 rounded-xl", text: "text-sm" },
  lg: { box: "h-14 w-14 rounded-2xl", text: "text-lg" },
  xl: { box: "h-20 w-20 rounded-2xl", text: "text-xl" },
};

const SHAPE_OVERRIDE: Record<"circle" | "square", string> = {
  circle: "rounded-full",
  square: "",
};

export function pickAvatarTone(seed: string): { bg: string; fg: string } {
  // Tiny FNV-1a-ish hash. Doesn't need to be cryptographic; just stable
  // across renders so colors don't flicker as React re-mounts cards.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}

export type EntityAvatarProps = {
  initials: string;
  /** Stable seed for color choice. Falls back to `initials` when omitted. */
  colorSeed?: string;
  size?: EntityAvatarSize;
  /** Default rounded-square shape. Pass `circle` to force a pill. */
  shape?: "circle" | "square";
  /** Optional ring (used on the student detail header to suggest selection). */
  ring?: boolean;
  /** Render in a "pending" state (dashed ring, "?" placeholder). Used for
   * invited-but-not-accepted users. */
  pending?: boolean;
  /** Slot for status dot etc. — stacked over the bottom-right corner. */
  badge?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function EntityAvatar({
  initials,
  colorSeed,
  size = "md",
  shape = "square",
  ring = false,
  pending = false,
  badge,
  className,
  ariaLabel,
}: EntityAvatarProps) {
  const tokens = SIZE_TOKENS[size];
  const tone = pickAvatarTone(colorSeed ?? initials);
  const display = pending ? "?" : initials.slice(0, 2).toUpperCase() || "?";

  const shapeCls = SHAPE_OVERRIDE[shape];
  const ringCls = ring ? "ring-2 ring-white/20" : "";
  const pendingCls = pending ? "border border-dashed border-white/40" : "";
  const cls = [
    "relative inline-flex select-none items-center justify-center font-semibold tracking-wide",
    tokens.box,
    shapeCls,
    tokens.text,
    ringCls,
    pendingCls,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const pendingStyle = pending
    ? { backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)" }
    : { backgroundColor: tone.bg, color: tone.fg };

  return (
    <span
      className={cls}
      style={pendingStyle}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    >
      {display}
      {badge ? (
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Build initials from a person's full name. Used in tests too, hence
 * exported. Single-word names fall back to the first two letters so we
 * never end up rendering a single character.
 */
export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) {
    const t0 = tokens[0]!;
    return (t0.slice(0, 2) || "?").toUpperCase();
  }
  return ((tokens[0]![0] ?? "") + (tokens[tokens.length - 1]![0] ?? "")).toUpperCase();
}

/** Variant of {@link initialsFromName} that lets the caller pick the fallback
 * character (e.g. "?" or "•"). Used by the users-branch routes. */
export function deriveInitials(
  name: string | null | undefined,
  fallback = "?",
): string {
  const out = initialsFromName(name);
  return out === "?" ? fallback : out;
}

export default EntityAvatar;
