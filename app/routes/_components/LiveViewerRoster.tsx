import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { Eye } from "lucide-react";
import { formatActorLabel } from "~/domain/auth/format-actor";
import type { RosterPresenceEntry } from "~/domain/drills/presence-roster";

const VISIBLE_AVATAR_LIMIT = 5;

type Props = {
  // Full roster of authed (signed-in) viewers, including the current user. The
  // component does NOT auto-filter "self" — callers may want to render their
  // own chip and rely on this component for everyone else, or include self for
  // a Google-Docs-style "you're here too" indicator. Today drills.live.tsx
  // dedupes self in the WS handler before this list is built.
  roster: RosterPresenceEntry[];
  // The current user's id. If any entry's `onBehalfOfUserId === selfUserId`,
  // we render an "(impersonating you)" suffix + amber border on that chip so
  // the user immediately sees they are being puppeted.
  selfUserId: string | null;
  // Anonymous viewer-pin guests collapse to a single "👁 N viewers" chip.
  // 0 → no chip rendered.
  guestCount: number;
};

// Initials from a label, max 2 chars. "Noah Sundberg" → "NS", "demo" → "D".
function initialsOf(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable per-user color from a simple hash of userId. Mirrors the
// `userColor()` in drills.live.tsx so a viewer's own pill colors and their
// roster avatar match. Kept inline (rather than importing from the route
// module) so this component has no dependency on the route's loader/action
// graph.
function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 70% 60%)`;
}

function ViewerChip({
  entry,
  selfUserId,
  t,
}: {
  entry: RosterPresenceEntry;
  selfUserId: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isImpersonatingMe =
    selfUserId !== null && entry.onBehalfOfUserId === selfUserId;
  const baseLabel = formatActorLabel(
    entry.label,
    entry.onBehalfOfLabel,
    entry.label ?? "",
  );
  const tooltip = isImpersonatingMe
    ? `${baseLabel} ${t("drillsLive.viewerRoster.impersonatingYou")}`
    : baseLabel;
  // Prefer the impersonator's name (if present) for initials so it stays
  // recognizable; fall back to the impersonated label or "?" if both are
  // empty (defensive — shouldn't happen for authed entries).
  const initialsSource = entry.label ?? entry.onBehalfOfLabel ?? "";
  const ringClass = isImpersonatingMe
    ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-[#181c1c]"
    : "";
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow-sm ${ringClass}`}
      style={{ backgroundColor: entry.color || colorFor(entry.userId) }}
    >
      {initialsOf(initialsSource)}
    </span>
  );
}

export function LiveViewerRoster({ roster, selfUserId, guestCount }: Props) {
  const { t } = useTranslation("roster");
  const [overflowOpen, setOverflowOpen] = useState(false);

  const visible = roster.slice(0, VISIBLE_AVATAR_LIMIT);
  const overflow = roster.slice(VISIBLE_AVATAR_LIMIT);

  if (roster.length === 0 && guestCount === 0) {
    // Nobody on the wire yet — render nothing rather than an empty container
    // so we don't take up header space.
    return null;
  }

  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label={t("drillsLive.viewerRoster.ariaLabel", {
        defaultValue: "Live viewers",
      })}
    >
      {visible.map((entry) => (
        <ViewerChip
          key={entry.userId}
          entry={entry}
          selfUserId={selfUserId}
          t={t}
        />
      ))}

      {overflow.length > 0 && (
        <Popover isOpen={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger>
            <button
              type="button"
              className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-white/90 hover:bg-white/20"
              aria-label={t("drillsLive.viewerRoster.overflowLabel", {
                count: overflow.length,
              })}
            >
              +{overflow.length}
            </button>
          </PopoverTrigger>
          <PopoverContent placement="bottom end" className="p-2 max-w-xs">
            <ul className="flex flex-col gap-1.5">
              {overflow.map((entry) => {
                const isImpersonatingMe =
                  selfUserId !== null &&
                  entry.onBehalfOfUserId === selfUserId;
                const baseLabel = formatActorLabel(
                  entry.label,
                  entry.onBehalfOfLabel,
                  entry.label ?? "",
                );
                return (
                  <li
                    key={entry.userId}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          entry.color || colorFor(entry.userId),
                      }}
                    />
                    <span className="text-white/90">
                      {baseLabel}
                      {isImpersonatingMe && (
                        <span className="ml-1 text-amber-300">
                          {t("drillsLive.viewerRoster.impersonatingYou")}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}

      {guestCount > 0 && (
        <span
          title={t("drillsLive.viewerRoster.guestsTooltip")}
          aria-label={t("drillsLive.viewerRoster.guestsTooltip")}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 text-[11px] font-medium text-white/80"
        >
          <Eye className="h-3 w-3" aria-hidden="true" />
          {t("drillsLive.viewerRoster.guestsLabel", { count: guestCount })}
        </span>
      )}
    </div>
  );
}
