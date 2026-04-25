import { Check, X } from "lucide-react";
import {
  emptyRunState,
  type RunState,
  type TemplateDefinition,
  type ToggleValue,
  toggleKey,
} from "./types";

export function ChecklistTable({
  definition,
  state,
  onToggle,
  readOnly = false,
}: {
  definition: TemplateDefinition;
  state: RunState;
  onToggle: (rowId: string, colId: string) => void;
  /** When true, toggle cells render as disabled buttons and ignore clicks.
   *  Used on the /drills/live screen while status is PAUSED. */
  readOnly?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm min-w-[480px]">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            {definition.columns.map((col) => (
              <th
                key={col.id}
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white/60"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {definition.rows.map((row) => (
            <tr key={row.id} className="border-b border-white/5">
              {definition.columns.map((col) => (
                <td key={col.id} className="px-3 py-2 align-middle">
                  {col.kind === "text" ? (
                    <span className="text-white">{row.cells[col.id] ?? ""}</span>
                  ) : (
                    <ToggleCell
                      value={state.toggles[toggleKey(row.id, col.id)] ?? null}
                      onToggle={() => onToggle(row.id, col.id)}
                      disabled={readOnly}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tri-state toggle cell. Click cycles blank → positive → negative → blank.
 *
 * Accessibility: color alone is not sufficient (roughly 1 in 12 men are
 * red-green color-blind, and the green/red hues used here are the hardest
 * pair to distinguish). We stack three non-color signals so the state
 * reads unambiguously with any vision:
 *   - Shape: check mark for positive, X for negative, empty square for blank.
 *   - Diagonal stripe pattern: forward-slashes on positive, back-slashes on
 *     negative — two different textures that survive any tritanopia /
 *     deuteranopia / protanopia filter.
 *   - Accessible name + aria-label announce the current state to screen
 *     readers, and the button uses `role="button"` with `aria-pressed`
 *     triples ("true" / "mixed" for negative / "false" for blank) so
 *     assistive tech doesn't collapse the three states into two.
 */
function ToggleCell({
  value,
  onToggle,
  disabled = false,
}: {
  value: ToggleValue | null;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const stateLabel =
    value === "positive" ? "Yes" : value === "negative" ? "No" : "Blank";
  const ariaPressed: "true" | "mixed" | "false" =
    value === "positive" ? "true" : value === "negative" ? "mixed" : "false";

  // The pattern is a CSS repeating-linear-gradient over the button. We
  // inline the style so we can flip slope per state without dragging in
  // a Tailwind plugin or config change. The semi-transparent white stripe
  // is visible on both the green and red fills and survives any color
  // filter applied by the OS / browser for color-blind users.
  const patternStyle =
    value === "positive"
      ? {
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.18) 6px 9px)",
        }
      : value === "negative"
        ? {
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent 0 6px, rgba(255,255,255,0.22) 6px 9px)",
          }
        : undefined;

  const base =
    "inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg border-2 transition-colors";
  const stateCls =
    value === "positive"
      ? "border-emerald-500 bg-emerald-600/40 text-emerald-50"
      : value === "negative"
        ? "border-rose-500 bg-rose-600/40 text-rose-50"
        : "border-white/20 bg-white/5 text-white/30 hover:border-white/40";
  const disabledCls = disabled
    ? "opacity-60 cursor-not-allowed hover:border-white/20"
    : "";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={ariaPressed}
      aria-label={`Toggle — currently ${stateLabel}. Click to cycle.`}
      title={`${stateLabel} — click to change`}
      style={patternStyle}
      className={`${base} ${stateCls} ${disabledCls}`}
    >
      {value === "positive" ? (
        <Check className="w-5 h-5" aria-hidden="true" />
      ) : value === "negative" ? (
        <X className="w-5 h-5" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="block h-5 w-5 rounded-sm border border-white/15" />
      )}
      <span className="sr-only">{stateLabel}</span>
    </button>
  );
}

/**
 * Read-only preview of a template as it will appear on the run screen.
 * Used in the template editor as a live WYSIWYG pane.
 */
export function ChecklistPreview({ definition }: { definition: TemplateDefinition }) {
  return (
    <ChecklistTable
      definition={definition}
      state={emptyRunState()}
      onToggle={() => {
        /* preview only */
      }}
    />
  );
}
