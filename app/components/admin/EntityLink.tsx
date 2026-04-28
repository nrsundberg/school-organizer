import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";

export function EntityLink({
  to,
  arrow = false,
  children,
  className = "",
}: {
  to: string;
  arrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1 text-blue-300 underline-offset-2 hover:underline ${className}`}
    >
      {children}
      {arrow ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : null}
    </Link>
  );
}
