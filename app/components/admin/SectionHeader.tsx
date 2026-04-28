import type { ReactNode } from "react";

export function SectionHeader({
  title,
  count,
  actions,
  className = "",
}: {
  title: ReactNode;
  count?: number | string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
        <span>{title}</span>
        {count != null ? (
          <span className="text-xs font-normal text-white/45">({count})</span>
        ) : null}
      </h3>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}
