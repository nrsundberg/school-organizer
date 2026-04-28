import type { ReactNode } from "react";

/**
 * Eyebrow-style group header used to break the children/students pages into
 * scannable sections (e.g. "Kindergarten · 2 classrooms · 41 students"). The
 * title is uppercase + tracked, with an optional inline count badge and a
 * thin horizontal rule that fills the remaining width.
 */

export type SectionHeaderProps = {
  title: string;
  /** Numeric badge rendered next to the title — typically "n classrooms". */
  count?: number | string;
  /** Secondary inline caption ("· 41 students"). Optional. */
  caption?: string;
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
  actions,
  id,
  className,
}: SectionHeaderProps) {
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
