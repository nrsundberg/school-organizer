import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";

export interface EntityLinkProps {
  to: string;
  arrow?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Inline link styled for admin pages — subtle blue accent, optional
 * trailing arrow. Lives next to other entity-affordance primitives so the
 * hover/focus treatment stays consistent across Households/Users/Students.
 */
export function EntityLink({
  to,
  arrow = false,
  className = "",
  children,
}: EntityLinkProps) {
  return (
    <Link
      to={to}
      className={[
        "inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline underline-offset-2 transition-colors",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{children}</span>
      {arrow ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
    </Link>
  );
}

export default EntityLink;
