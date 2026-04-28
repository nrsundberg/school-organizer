import type { ReactNode } from "react";

/**
 * Single tile in the stats row above the index. The default tone matches the
 * generic dark card (white-on-dark); `warning` swaps to amber to flag
 * attention items like "unassigned students".
 */

export type StatCardTone = "default" | "warning" | "info" | "success";

const TONE_RING: Record<StatCardTone, string> = {
  default: "border-white/[0.08]",
  warning: "border-amber-400/30",
  info: "border-blue-400/30",
  success: "border-emerald-400/30",
};

const TONE_VALUE_COLOR: Record<StatCardTone, string> = {
  default: "text-white",
  warning: "text-amber-200",
  info: "text-blue-200",
  success: "text-emerald-200",
};

const TONE_BG: Record<StatCardTone, string> = {
  default: "bg-white/[0.04]",
  warning: "bg-amber-500/[0.06]",
  info: "bg-blue-500/[0.06]",
  success: "bg-emerald-500/[0.06]",
};

export type StatCardProps = {
  label: string;
  /** Primary metric value — already formatted for display. */
  value: ReactNode;
  /** Optional secondary line under the value (e.g. "+ 3 since last week"). */
  caption?: ReactNode;
  /** Optional leading icon, rendered top-right (subtle, decorative). */
  icon?: ReactNode;
  tone?: StatCardTone;
  /** Optional click target — when set the whole card becomes a button. */
  onClick?: () => void;
  href?: string;
};

export function StatCard({
  label,
  value,
  caption,
  icon,
  tone = "default",
  onClick,
  href,
}: StatCardProps) {
  const cls = [
    "flex flex-col gap-2 rounded-xl border p-4",
    TONE_RING[tone],
    TONE_BG[tone],
    onClick || href ? "cursor-pointer transition-colors hover:bg-white/[0.06]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.9px] text-white/45">
          {label}
        </p>
        {icon ? (
          <span className="text-white/40" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <p className={`text-2xl font-semibold leading-none ${TONE_VALUE_COLOR[tone]}`}>
        {value}
      </p>
      {caption ? (
        <p className="text-xs text-white/55">{caption}</p>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} text-left`}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
