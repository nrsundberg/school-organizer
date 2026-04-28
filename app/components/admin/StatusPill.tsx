import type { ReactNode } from "react";

export type PillTone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "cyan"
  | "purple";

const TONE_CLASS: Record<PillTone, string> = {
  info: "bg-blue-500/15 text-blue-200 border-blue-400/25",
  success: "bg-emerald-500/15 text-emerald-200 border-emerald-400/25",
  warning: "bg-amber-500/15 text-amber-200 border-amber-400/25",
  danger: "bg-rose-500/15 text-rose-200 border-rose-400/25",
  neutral: "bg-white/[0.06] text-white/70 border-white/10",
  cyan: "bg-cyan-500/15 text-cyan-200 border-cyan-400/25",
  purple: "bg-violet-500/15 text-violet-200 border-violet-400/25",
};

export function StatusPill({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
