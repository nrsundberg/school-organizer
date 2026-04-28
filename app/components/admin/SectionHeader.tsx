import type { ReactNode } from "react";

export interface SectionHeaderProps {
  title: ReactNode;
  /** Inline numeric badge after the title (e.g. children count). */
  count?: number | string;
  /** Optional subtitle/explanation rendered below the title. */
  subtitle?: ReactNode;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Right-aligned action area (buttons, links, etc.). */
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  count,
  subtitle,
  icon,
  actions,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={[
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="inline-flex shrink-0 text-white/70">{icon}</span>
          ) : null}
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {count !== undefined && count !== null ? (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs font-medium text-white/70">
              {count}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <p className="mt-1 text-sm text-white/55">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export default SectionHeader;
