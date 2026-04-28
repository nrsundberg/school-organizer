import type { ReactNode } from "react";

export type StatusPillTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "cyan"
  | "purple";

const TONE_CLASSES: Record<StatusPillTone, string> = {
  info: "bg-blue-500/15 text-blue-200 border-blue-400/25",
  success: "bg-emerald-500/15 text-emerald-200 border-emerald-400/25",
  warning: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  danger: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  neutral: "bg-white/5 text-white/70 border-white/10",
  cyan: "bg-cyan-500/15 text-cyan-200 border-cyan-400/25",
  purple: "bg-purple-500/15 text-purple-200 border-purple-400/25",
};

export interface StatusPillProps {
  tone?: StatusPillTone;
  /** Render small (tighter padding/text). Default true; matches prior usage. */
  size?: "xs" | "sm";
  /** Optional leading icon. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function StatusPill({
  tone = "neutral",
  size = "sm",
  icon,
  className = "",
  children,
}: StatusPillProps) {
  const sizeClass =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px]"
      : "px-2 py-0.5 text-xs";
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        sizeClass,
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}

export default StatusPill;
