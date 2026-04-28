import type { CSSProperties } from "react";

type Size = "sm" | "md" | "lg";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

// Eight muted accents that read well on the dark panel background. Picked
// deterministically from `colorSeed` so the same person always renders in
// the same color across pages.
const PALETTE = [
  { bg: "rgba(96,165,250,0.18)", fg: "#bfdbfe" },   // blue
  { bg: "rgba(167,139,250,0.18)", fg: "#ddd6fe" },  // violet
  { bg: "rgba(244,114,182,0.18)", fg: "#fbcfe8" },  // pink
  { bg: "rgba(251,191,36,0.18)", fg: "#fde68a" },   // amber
  { bg: "rgba(52,211,153,0.18)", fg: "#a7f3d0" },   // emerald
  { bg: "rgba(94,234,212,0.18)", fg: "#99f6e4" },   // teal
  { bg: "rgba(251,113,133,0.18)", fg: "#fecdd3" },  // rose
  { bg: "rgba(148,163,184,0.18)", fg: "#e2e8f0" },  // slate
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function EntityAvatar({
  initials,
  colorSeed,
  size = "md",
  pending = false,
  className = "",
}: {
  initials: string;
  colorSeed: string;
  size?: Size;
  /** Pending invites render with a dashed ring + "?" instead of initials. */
  pending?: boolean;
  className?: string;
}) {
  const palette = PALETTE[hashSeed(colorSeed) % PALETTE.length];
  const style: CSSProperties = pending
    ? { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)" }
    : { background: palette.bg, color: palette.fg };
  const ring = pending
    ? "border border-dashed border-white/30"
    : "border border-white/10";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold ${SIZE_CLASS[size]} ${ring} ${className}`}
      style={style}
      aria-hidden="true"
    >
      {pending ? "?" : initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function deriveInitials(name: string | null | undefined, fallback = "?"): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return fallback;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return (parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "");
}
