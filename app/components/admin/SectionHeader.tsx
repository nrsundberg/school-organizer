import type { ReactNode } from "react";

/**
 * Group header used across the redesigned admin pages. Two visual modes:
 *
 * - "eyebrow" (default): uppercase + tracked title with a thin horizontal
 *   rule filling the remaining width. Used to break list pages into
 *   scannable sections (children grade groups, student-detail forms).
 * - "heavy": normal-case h2 with optional icon and subtitle line. Used on
 *   detail pages where each section needs more visual weight.
 *
 * The heavy mode kicks in automatically whenever `subtitle` or `icon` is
 * passed, so call sites just supply props and don't pick a variant.
 */

export type SectionHeaderProps = {
  title: ReactNode;
  /** Numeric badge rendered next to the title — typically "n classrooms". */
  count?: number | string;
  /** Secondary inline caption ("· 41 students"). Optional, eyebrow mode. */
  caption?: string;
  /** Optional subtitle/explanation rendered below the title. Switches the
   * header to the heavier h2 layout used on detail pages. */
  subtitle?: ReactNode;
  /** Optional icon rendered before the title. Switches the header to the
   * heavier h2 layout used on detail pages. */
  icon?: ReactNode;
  /** Right-aligned actions (buttons, dropdown, etc.). */
  actions?: ReactNode;
  /** Anchor id for in-page nav (deep links to grade groups). */
  id?: string;
  className?: string;
};

export function SectionHeader({
  title,
  count,
  caption,
  subtitle,
  icon,
  actions,
  id,
  className,
}: SectionHeaderProps) {
  const heavy = subtitle !== undefined || icon !== undefined;

  if (heavy) {
    return (
      <div
        id={id}
        className={[
          "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
          className ?? "",
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
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-medium text-white/70">
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

  return (
    <div
      id={id}
      className={[
        "flex items-center gap-3",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.9px] text-white/45">
          {title}
        </h3>
        {count !== undefined ? (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/70 ring-1 ring-inset ring-white/10">
            {count}
          </span>
        ) : null}
        {caption ? (
          <span className="text-[11px] uppercase tracking-[0.9px] text-white/40">
            · {caption}
          </span>
        ) : null}
      </div>
      <div className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default SectionHeader;
