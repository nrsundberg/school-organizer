import { AlertTriangle, Check, Undo2, X } from "lucide-react";
import {
  emptyRunState,
  type ClassroomAttestation,
  type RunState,
  type TemplateDefinition,
  type ToggleValue,
  toggleKey,
} from "./types";

/**
 * Optional per-row attestation hooks. When provided, the table renders a
 * trailing column with an "all-clear / issue / undo" control next to each
 * row so individual teachers can sign off their own classroom from their
 * own phone. Backwards compatible: omit the props (e.g. in the template
 * preview) and the column doesn't render at all.
 */
export type AttestationProps = {
  /** Map of rowId → attestation entry (RunState.classroomAttestations). */
  attestations: Record<string, ClassroomAttestation>;
  /** "all-clear" or "issue" — sets / overwrites the entry for the row. */
  onAttest: (rowId: string, status: "all-clear" | "issue", note?: string) => void;
  /** Removes the row's attestation entry (the "undo" button). */
  onUnattest: (rowId: string) => void;
  /**
   * Localized strings — passed in so the component stays i18n-namespace
   * neutral. `attestedBy` uses {{name}} and {{time}} interpolation tokens.
   */
  labels: {
    columnHeader: string;
    attest: string;
    issue: string;
    undo: string;
    issueNotePlaceholder: string;
    issueNoteSave: string;
    attestedBy: string;
  };
};

export function ChecklistTable({
  definition,
  state,
  onToggle,
  readOnly = false,
  attestation,
}: {
  definition: TemplateDefinition;
  state: RunState;
  onToggle: (rowId: string, colId: string) => void;
  /** When true, toggle cells render as disabled buttons and ignore clicks.
   *  Used on the /drills/live screen while status is PAUSED. */
  readOnly?: boolean;
  /** When provided, a trailing per-row attestation column is rendered. */
  attestation?: AttestationProps;
}) {
  const showAttest = !!attestation;
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
            {showAttest && (
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-white/60"
              >
                {attestation.labels.columnHeader}
              </th>
            )}
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
              {showAttest && (
                <td className="px-3 py-2 align-middle">
                  <AttestationCell
                    rowId={row.id}
                    entry={attestation.attestations[row.id] ?? null}
                    onAttest={attestation.onAttest}
                    onUnattest={attestation.onUnattest}
                    labels={attestation.labels}
                    disabled={readOnly}
                  />
                </td>
              )}
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
 * Per-row attestation control. Three visual states:
 *
 *   1. Not yet attested — show "Attest all-clear" + a smaller "Issue?" link.
 *   2. Attested all-clear — show "✓ {byLabel} @ HH:MM" + "Issue?" + Undo.
 *   3. Attested with issue — show ⚠ banner with note + Undo.
 *
 * The cell is intentionally compact so it fits a phone screen alongside the
 * row's existing text columns. Clicking these buttons does NOT touch the
 * row's toggle column — that's a deliberately separate input.
 */
function AttestationCell({
  rowId,
  entry,
  onAttest,
  onUnattest,
  labels,
  disabled,
}: {
  rowId: string;
  entry: ClassroomAttestation | null;
  onAttest: (rowId: string, status: "all-clear" | "issue", note?: string) => void;
  onUnattest: (rowId: string) => void;
  labels: AttestationProps["labels"];
  disabled: boolean;
}) {
  if (!entry) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onAttest(rowId, "all-clear")}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-600/20 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          {labels.attest}
        </button>
        <IssueButton
          rowId={rowId}
          onAttest={onAttest}
          labels={labels}
          disabled={disabled}
        />
      </div>
    );
  }

  if (entry.status === "all-clear") {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600/30 px-2 py-1 text-xs font-medium text-emerald-100">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="whitespace-nowrap">
            {labels.attestedBy
              .replace("{{name}}", entry.byLabel)
              .replace("{{time}}", formatTime(entry.attestedAt))}
          </span>
        </span>
        <IssueButton
          rowId={rowId}
          onAttest={onAttest}
          labels={labels}
          disabled={disabled}
        />
        <UndoButton
          rowId={rowId}
          onUnattest={onUnattest}
          labels={labels}
          disabled={disabled}
        />
      </div>
    );
  }

  // status === "issue"
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-600/30 px-2 py-1 text-xs font-medium text-amber-100">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="whitespace-nowrap">
          {labels.attestedBy
            .replace("{{name}}", entry.byLabel)
            .replace("{{time}}", formatTime(entry.attestedAt))}
        </span>
        {entry.note ? (
          <span className="ml-1 italic text-amber-100/80">— {entry.note}</span>
        ) : null}
      </span>
      <UndoButton
        rowId={rowId}
        onUnattest={onUnattest}
        labels={labels}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * "Issue?" affordance with an inline note input. Implemented as a
 * native <details> + <form> so the markup stays a leaf — no extra
 * useState in ChecklistTable, and dismissing keyboard / touch is the
 * built-in browser behavior. On submit we send onAttest("issue", note).
 */
function IssueButton({
  rowId,
  onAttest,
  labels,
  disabled,
}: {
  rowId: string;
  onAttest: (rowId: string, status: "all-clear" | "issue", note?: string) => void;
  labels: AttestationProps["labels"];
  disabled: boolean;
}) {
  return (
    <details className="group">
      <summary
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-500/50 bg-amber-600/20 px-2 py-1 text-xs font-medium text-amber-100 hover:bg-amber-600/30 transition-colors marker:hidden list-none"
        aria-disabled={disabled}
      >
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        {labels.issue}
      </summary>
      <form
        className="mt-1 flex flex-wrap items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          const fd = new FormData(e.currentTarget);
          const note = String(fd.get("note") ?? "").trim();
          onAttest(rowId, "issue", note.length > 0 ? note : undefined);
          // Close the <details> after submit so the button area collapses.
          const details = e.currentTarget.closest("details") as HTMLDetailsElement | null;
          if (details) details.removeAttribute("open");
          (e.currentTarget as HTMLFormElement).reset();
        }}
      >
        <input
          name="note"
          type="text"
          autoComplete="off"
          disabled={disabled}
          placeholder={labels.issueNotePlaceholder}
          className="flex-1 min-w-[10rem] rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-amber-500 px-2 py-1 text-xs font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {labels.issueNoteSave}
        </button>
      </form>
    </details>
  );
}

function UndoButton({
  rowId,
  onUnattest,
  labels,
  disabled,
}: {
  rowId: string;
  onUnattest: (rowId: string) => void;
  labels: AttestationProps["labels"];
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onUnattest(rowId)}
      disabled={disabled}
      aria-label={labels.undo}
      title={labels.undo}
      className="inline-flex items-center justify-center rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
}

/**
 * Render an ISO timestamp as "HH:MM" in 24-hour format. Falls back to
 * the raw string if the date can't be parsed (defensive — the field is
 * stored ISO-encoded so this should be rare).
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
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
