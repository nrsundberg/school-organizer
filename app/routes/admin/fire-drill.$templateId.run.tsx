import { Link, useFetcher, useRevalidator } from "react-router";
import { Button } from "@heroui/react";
import { ArrowLeft, Check, Plus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/fire-drill.$templateId.run";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  type RunState,
  type TemplateDefinition,
  emptyRunState,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
} from "~/domain/fire-drill/types";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Prisma } from "~/db";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.template ? `Run – ${data.template.name}` : "Run checklist" },
];

export async function loader({ context, params }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const templateId = params.templateId;
  if (!templateId) {
    throw new Response("Not found", { status: 404 });
  }
  const template = await prisma.fireDrillTemplate.findFirst({
    where: { id: templateId },
    select: { id: true, name: true, definition: true, updatedAt: true },
  });
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }

  let run = await prisma.fireDrillRun.findUnique({
    where: { templateId },
    select: { id: true, state: true, updatedAt: true },
  });
  if (!run) {
    const orgId = getOrgFromContext(context).id;
    run = await prisma.fireDrillRun.create({
      data: {
        orgId,
        templateId,
        state: emptyRunState() as object,
      },
      select: { id: true, state: true, updatedAt: true },
    });
  }

  return { template, run };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const templateId = params.templateId;
  if (!templateId) {
    return dataWithError(null, "Missing template.");
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const orgId = getOrgFromContext(context).id;

  if (intent === "saveState") {
    const raw = String(formData.get("state") ?? "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return dataWithError(null, "Invalid state JSON.");
    }
    const state = parseRunState(parsed as Prisma.JsonValue);
    await prisma.fireDrillRun.upsert({
      where: { templateId },
      create: {
        orgId,
        templateId,
        state: state as object,
      },
      update: {
        state: state as object,
      },
    });
    return dataWithSuccess(null, "Saved.");
  }

  if (intent === "reset") {
    await prisma.fireDrillRun.upsert({
      where: { templateId },
      create: {
        orgId,
        templateId,
        state: emptyRunState() as object,
      },
      update: {
        state: emptyRunState() as object,
      },
    });
    return dataWithSuccess(null, "Checklist cleared.");
  }

  return dataWithError(null, "Unknown action.");
}

function newId(): string {
  return crypto.randomUUID();
}

export default function FireDrillRunPage({ loaderData }: Route.ComponentProps) {
  const { template, run } = loaderData;
  const def = parseTemplateDefinition(template.definition);
  const [state, setState] = useState<RunState>(() => parseRunState(run.state));
  const fetcher = useFetcher();
  const revalidator = useRevalidator();

  useEffect(() => {
    setState(parseRunState(run.state));
  }, [run.id, run.updatedAt, run.state]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data != null) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const toggleCell = useCallback((rowId: string, colId: string) => {
    const key = toggleKey(rowId, colId);
    setState((s) => ({
      ...s,
      toggles: { ...s.toggles, [key]: !s.toggles[key] },
    }));
  }, []);

  const setNotes = useCallback((notes: string) => {
    setState((s) => ({ ...s, notes }));
  }, []);

  const addActionItem = useCallback(() => {
    setState((s) => ({
      ...s,
      actionItems: [...s.actionItems, { id: newId(), text: "", done: false }],
    }));
  }, []);

  const updateActionItem = useCallback((id: string, text: string) => {
    setState((s) => ({
      ...s,
      actionItems: s.actionItems.map((a) => (a.id === id ? { ...a, text } : a)),
    }));
  }, []);

  const toggleActionDone = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      actionItems: s.actionItems.map((a) => (a.id === id ? { ...a, done: !a.done } : a)),
    }));
  }, []);

  const removeActionItem = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      actionItems: s.actionItems.filter((a) => a.id !== id),
    }));
  }, []);

  const persist = () => {
    const fd = new FormData();
    fd.set("intent", "saveState");
    fd.set("state", JSON.stringify(state));
    fetcher.submit(fd, { method: "post" });
  };

  const reset = () => {
    if (!confirm("Clear all checks, notes, and follow-up items for this template?")) {
      return;
    }
    const fd = new FormData();
    fd.set("intent", "reset");
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[min(100%,56rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={`/admin/fire-drill/${template.id}`}
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Edit layout
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onPress={persist}
            isPending={fetcher.state !== "idle"}
          >
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onPress={reset}>
            Clear all
          </Button>
          <Link
            to={`/admin/print/fire-drill/${template.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
          >
            <Printer className="w-4 h-4" />
            Print
          </Link>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white">{template.name}</h1>
        <p className="text-white/50 text-sm mt-1">Tap toggle cells during the drill. Green means checked.</p>
      </div>

      <ChecklistTable definition={def} state={state} onToggle={toggleCell} />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">Notes</h2>
        <textarea
          value={state.notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-white/20 bg-[#1a1f1f] px-3 py-2 text-white text-sm placeholder:text-white/30"
          placeholder="Incidents, headcount issues, etc."
        />
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-white">Follow-up items</h2>
          <Button type="button" size="sm" variant="secondary" onPress={addActionItem}>
            <Plus className="w-4 h-4 mr-1 inline" />
            Add
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {state.actionItems.length === 0 ? (
            <li className="text-white/40 text-sm">No items yet. Add reminders (e.g. check who has Johnny).</li>
          ) : (
            state.actionItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleActionDone(item.id)}
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border ${
                    item.done ? "border-emerald-500 bg-emerald-600/30 text-emerald-200" : "border-white/20 bg-white/5 text-white/40"
                  }`}
                  aria-pressed={item.done}
                  aria-label={item.done ? "Mark not done" : "Mark done"}
                >
                  {item.done && <Check className="w-4 h-4" />}
                </button>
                <input
                  value={item.text}
                  onChange={(e) => updateActionItem(item.id, e.target.value)}
                  className="flex-1 min-w-[12rem] rounded border border-white/15 bg-[#1a1f1f] px-2 py-1.5 text-sm text-white"
                  placeholder="Follow-up task…"
                />
                <button
                  type="button"
                  onClick={() => removeActionItem(item.id)}
                  className="p-2 text-rose-300 hover:bg-rose-500/10 rounded"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <Button type="button" variant="primary" onPress={persist} isPending={fetcher.state !== "idle"}>
        Save checklist
      </Button>
    </div>
  );
}

function ChecklistTable({
  definition,
  state,
  onToggle,
}: {
  definition: TemplateDefinition;
  state: RunState;
  onToggle: (rowId: string, colId: string) => void;
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

function ToggleCell({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pressed}
      className={`inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg border-2 transition-colors ${
        pressed
          ? "border-emerald-500 bg-emerald-600/35 text-emerald-100"
          : "border-white/20 bg-white/5 text-white/30 hover:border-white/40"
      }`}
    >
      {pressed ? <Check className="w-5 h-5" /> : <span className="text-xs text-white/30"> </span>}
    </button>
  );
}
