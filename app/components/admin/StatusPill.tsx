import type { ReactNode } from "react";

/**
 * Compact pill for status / metadata inline with text. Tones map to the
 * dark-theme accent palette documented in the redesign brief. Keep colors
 * literal here so we don't accidentally drift from the design tokens.
 */

export type StatusPillTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "cyan"
  | "purple";

const TONE_STYLES: Record<StatusPillTone, { bg: string; fg: string; ring: string }> = {
  info:    { bg: "rgba(59,130,246,0.14)",  fg: "#93c5fd", ring: "rgba(59,130,246,0.35)" },
  success: { bg: "rgba(16,185,129,0.14)",  fg: "#6ee7b7", ring: "rgba(16,185,129,0.35)" },
  warning: { bg: "rgba(245,158,11,0.16)",  fg: "#fcd34d", ring: "rgba(245,158,11,0.35)" },
  danger:  { bg: "rgba(244,63,94,0.16)",   fg: "#fda4af", ring: "rgba(244,63,94,0.35)" },
  neutral: { bg: "rgba(255,255,255,0.06)", fg: "#d4d4d8", ring: "rgba(255,255,255,0.14)" },
  cyan:    { bg: "rgba(6,182,212,0.16)",   fg: "#67e8f9", ring: "rgba(6,182,212,0.35)" },
  purple:  { bg: "rgba(124,58,237,0.18)",  fg: "#c4b5fd", ring: "rgba(124,58,237,0.40)" },
};

export type StatusPillProps = {
  tone?: StatusPillTone;
  /** Optional leading icon — kept tiny so the pill stays compact. */
  icon?: ReactNode;
  /** Render as a simple dot pill (just a colored circle + label). */
  dot?: boolean;
  className?: string;
  children: ReactNode;
};

export function StatusPill({
  tone = "neutral",
  icon,
  dot = false,
  className,
  children,
}: StatusPillProps) {
  const style = TONE_STYLES[tone];
  const cls = [
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
    "ring-1 ring-inset",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={cls}
      style={{ backgroundColor: style.bg, color: style.fg, "--tw-ring-color": style.ring } as React.CSSProperties}
    >
      {dot ? (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: style.fg }}
          aria-hidden="true"
        />
      ) : null}
      {icon ? <span className="inline-flex h-3 w-3 items-center justify-center">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
