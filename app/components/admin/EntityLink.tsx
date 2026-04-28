import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";

/**
 * The signature blue cross-link used everywhere on the redesigned admin pages
 * — household → student → classroom → user. The `arrow` flag adds the small
 * "↗" icon to signal "navigates to a different entity" (versus an inline edit
 * action). The arrow uses the same color as the label so the underline + arrow
 * read as a single unit.
 */

export type EntityLinkProps = {
  to: string;
  /** Show the trailing arrow glyph. Default true since this is the most
   * common use case in the redesign. Pass false for inline cell links where
   * the arrow would be visually noisy (e.g. in dense tables). */
  arrow?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
};

export function EntityLink({
  to,
  arrow = true,
  className,
  children,
  onClick,
}: EntityLinkProps) {
  const cls = [
    "inline-flex items-center gap-0.5 text-[13px] font-medium text-[#60a5fa] underline-offset-4",
    "hover:text-[#93c5fd] hover:underline",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-0 rounded-sm",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={to} className={cls} onClick={onClick}>
      <span>{children}</span>
      {arrow ? (
        <ArrowUpRight className="h-3.5 w-3.5 -mr-0.5" aria-hidden="true" />
      ) : null}
    </Link>
  );
}

export default EntityLink;
