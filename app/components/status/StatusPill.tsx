import { useTranslation } from "react-i18next";
import type { ComponentStatus } from "~/domain/status/types";

/**
 * Compact status pill. Colour only encodes severity — never latency (user
 * decision: we don't publish numeric latency on the public page).
 */
export function StatusPill({
  status,
  size = "md",
}: {
  status: ComponentStatus;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation("common");
  const { label, classes, dotClass } = style(status, t);
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad} ${classes}`}
      aria-label={t("status.pill.ariaLabel", { label })}
    >
      <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function style(
  status: ComponentStatus,
  t: TFn,
): {
  label: string;
  classes: string;
  dotClass: string;
} {
  switch (status) {
    case "operational":
      return {
        label: t("status.pill.operational"),
        classes: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30",
        dotClass: "bg-emerald-400",
      };
    case "degraded":
      return {
        label: t("status.pill.degraded"),
        classes: "bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-400/30",
        dotClass: "bg-amber-400",
      };
    case "outage":
      return {
        label: t("status.pill.outage"),
        classes: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30",
        dotClass: "bg-red-400",
      };
    case "unknown":
    default:
      return {
        label: t("status.pill.unknown"),
        classes: "bg-white/5 text-white/60 ring-1 ring-inset ring-white/15",
        dotClass: "bg-white/40",
      };
  }
}
