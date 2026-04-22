import { Check } from "lucide-react";
import { emptyRunState, type RunState, type TemplateDefinition, toggleKey } from "./types";

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
                      pressed={!!state.toggles[toggleKey(row.id, col.id)]}
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

function ToggleCell({
  pressed,
  onToggle,
  disabled = false,
}: {
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pressed}
      className={`inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg border-2 transition-colors ${
        pressed
          ? "border-emerald-500 bg-emerald-600/35 text-emerald-100"
          : "border-white/20 bg-white/5 text-white/30 hover:border-white/40"
      } ${disabled ? "opacity-60 cursor-not-allowed hover:border-white/20" : ""}`}
    >
      {pressed ? <Check className="w-5 h-5" /> : <span className="text-xs text-white/30"> </span>}
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
