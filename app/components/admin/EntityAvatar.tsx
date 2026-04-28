import type { ReactNode } from "react";

/**
 * Deterministic palette of dark-theme-friendly avatar colors. We pick by
 * hashing `colorSeed` so the same household/student/contact always renders
 * with the same color across pages.
 */
const PALETTE = [
  { bg: "bg-blue-500/25", text: "text-blue-100", ring: "ring-blue-400/30" },
  { bg: "bg-emerald-500/25", text: "text-emerald-100", ring: "ring-emerald-400/30" },
  { bg: "bg-amber-500/25", text: "text-amber-100", ring: "ring-amber-400/30" },
  { bg: "bg-rose-500/25", text: "text-rose-100", ring: "ring-rose-400/30" },
  { bg: "bg-cyan-500/25", text: "text-cyan-100", ring: "ring-cyan-400/30" },
  { bg: "bg-purple-500/25", text: "text-purple-100", ring: "ring-purple-400/30" },
  { bg: "bg-indigo-500/25", text: "text-indigo-100", ring: "ring-indigo-400/30" },
  { bg: "bg-orange-500/25", text: "text-orange-100", ring: "ring-orange-400/30" },
] as const;

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function entityAvatarColor(seed: string): (typeof PALETTE)[number] {
  if (!seed) return PALETTE[0];
  return PALETTE[hash(seed) % PALETTE.length];
}

export type EntityAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<EntityAvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
};

const SHAPE_CLASSES: Record<"circle" | "square", string> = {
  circle: "rounded-full",
  square: "rounded-lg",
};

export interface EntityAvatarProps {
  /** Initials shown inside the avatar (max 2 chars rendered). */
  initials: string;
  /** Stable string used to deterministically pick the color. */
  colorSeed?: string;
  size?: EntityAvatarSize;
  shape?: "circle" | "square";
  ring?: boolean;
  className?: string;
  /** Optional overlay (e.g. status dot). */
  children?: ReactNode;
}

export function EntityAvatar({
  initials,
  colorSeed,
  size = "md",
  shape = "circle",
  ring = false,
  className = "",
  children,
}: EntityAvatarProps) {
  const palette = entityAvatarColor(colorSeed ?? initials);
  const trimmed = initials.trim().slice(0, 2).toUpperCase();
  return (
    <span
      className={[
        "relative inline-flex items-center justify-center font-semibold select-none",
        SIZE_CLASSES[size],
        SHAPE_CLASSES[shape],
        palette.bg,
        palette.text,
        ring ? `ring-2 ring-offset-0 ${palette.ring}` : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {trimmed || "?"}
      {children}
    </span>
  );
}

export default EntityAvatar;
