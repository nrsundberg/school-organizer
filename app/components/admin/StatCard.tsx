import type { PillTone } from "./StatusPill";

const TONE_ACCENT: Record<PillTone, string> = {
  info: "text-blue-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-rose-300",
  neutral: "text-white",
  cyan: "text-cyan-300",
  purple: "text-violet-300",
};

export function StatCard({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  caption?: string;
  tone?: PillTone;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.9px] text-white/45">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${TONE_ACCENT[tone]}`}>
        {value}
      </p>
      {caption ? (
        <p className="mt-1 text-xs text-white/55">{caption}</p>
      ) : null}
    </div>
  );
}
