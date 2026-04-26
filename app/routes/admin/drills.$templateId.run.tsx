import { Link, useFetcher, useRevalidator } from "react-router";
import { data } from "react-router";
import { ArrowLeft, Check, Plus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/drills.$templateId.run";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  type RunState,
  cycleToggle,
  emptyRunState,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
} from "~/domain/drills/types";
import { ChecklistTable } from "~/domain/drills/ChecklistTable";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Prisma } from "~/db";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? (data?.template ? `Run – ${data.template.name}` : "Run checklist") },
];

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const actor = getActorIdsFromContext(context);
  const prisma = getTenantPrisma(context);
  const templateId = params.templateId;
  if (!templateId) {
    throw new Response("Not found", { status: 404 });
  }
  const template = await prisma.drillTemplate.findFirst({
    where: { id: templateId },
    select: { id: true, name: true, definition: true, updatedAt: true },
  });
  if (!template) {
    throw new Response("Not found", { status: 404 });
  }

  // Migration 0021 dropped the unique-on-templateId constraint to allow run
  // history, so we look up the most recent run (if any) instead of findUnique.
  let run = await prisma.drillRun.findFirst({
    where: { templateId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, state: true, updatedAt: true },
  });
  if (!run) {
    const orgId = getOrgFromContext(context).id;
    run = await prisma.drillRun.create({
      data: {
        orgId,
        templateId,
        state: emptyRunState() as object,
        lastActorUserId: actor.actorUserId,
        lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
      },
      select: { id: true, state: true, updatedAt: true },
    });
  }

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  return {
    template,
    metaTitle: t("drills.metaRun", { name: template.name }),
    run: { ...run, updatedAtIso: run.updatedAt.toISOString() },
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const templateId = params.templateId;
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  if (!templateId) {
    return dataWithError(null, t("drills.run.errors.missingTemplate"));
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const orgId = getOrgFromContext(context).id;
  const actor = getActorIdsFromContext(context);

  if (intent === "saveState") {
    const raw = String(formData.get("state") ?? "");
    const expectedUpdatedAt = String(formData.get("expectedUpdatedAt") ?? "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return dataWithError(null, t("drills.run.errors.invalidStateJson"));
    }
    const state = parseRunState(parsed as Prisma.JsonValue);

    // Concurrency check: if expectedUpdatedAt is provided, verify no one else has saved more recently
    const currentRun = await prisma.drillRun.findFirst({
      where: { templateId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, updatedAt: true },
    });
    if (expectedUpdatedAt && currentRun && currentRun.updatedAt.toISOString() > expectedUpdatedAt) {
      return data(
        { error: t("drills.run.errors.concurrency") },
        { status: 409 },
      );
    }

    // Migration 0021 dropped the unique-on-templateId constraint, so we can't
    // use upsert(where: { templateId }) anymore. Find-then-update-or-create.
    if (currentRun) {
      await prisma.drillRun.update({
        where: { id: currentRun.id },
        data: {
          state: state as object,
          lastActorUserId: actor.actorUserId,
          lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
        },
      });
    } else {
      await prisma.drillRun.create({
        data: {
          orgId,
          templateId,
          state: state as object,
          lastActorUserId: actor.actorUserId,
          lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
        },
      });
    }
    return dataWithSuccess(null, t("drills.run.toasts.saved"));
  }

  if (intent === "reset") {
    const existingRun = await prisma.drillRun.findFirst({
      where: { templateId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existingRun) {
      await prisma.drillRun.update({
        where: { id: existingRun.id },
        data: {
          state: emptyRunState() as object,
          lastActorUserId: actor.actorUserId,
          lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
        },
      });
    } else {
      await prisma.drillRun.create({
        data: {
          orgId,
          templateId,
          state: emptyRunState() as object,
          lastActorUserId: actor.actorUserId,
          lastActorOnBehalfOfUserId: actor.onBehalfOfUserId,
        },
      });
    }
    return dataWithSuccess(null, t("drills.run.toasts.cleared"));
  }

  return dataWithError(null, t("drills.run.errors.unknown"));
}

function newId(): string {
  return crypto.randomUUID();
}

export default function DrillRunPage({ loaderData }: Route.ComponentProps) {
  const { template, run } = loaderData;
  const { t } = useTranslation("admin");
  const def = parseTemplateDefinition(template.definition);
  const [state, setState] = useState<RunState>(() => parseRunState(run.state));
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);

  useEffect(() => {
    setState(parseRunState(run.state));
  }, [run.id, run.updatedAt, run.state]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data != null) {
      const d = fetcher.data as { error?: string } | null;
      if (d && typeof d === "object" && "error" in d && d.error) {
        setConcurrencyError(d.error);
      } else {
        setConcurrencyError(null);
        revalidator.revalidate();
      }
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const toggleCell = useCallback((rowId: string, colId: string) => {
    const key = toggleKey(rowId, colId);
    setState((s) => {
      const next = cycleToggle(s.toggles[key]);
      const toggles = { ...s.toggles };
      // Store explicit positive/negative; drop the key entirely on blank so
      // saves stay compact and the payload matches parseRunState's model.
      if (next === null) {
        delete toggles[key];
      } else {
        toggles[key] = next;
      }
      return { ...s, toggles };
    });
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
    setConcurrencyError(null);
    const fd = new FormData();
    fd.set("intent", "saveState");
    fd.set("state", JSON.stringify(state));
    fd.set("expectedUpdatedAt", run.updatedAtIso);
    fetcher.submit(fd, { method: "post" });
  };

  const reset = () => {
    if (!confirm(t("drills.run.confirmReset"))) {
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
          to={`/admin/drills/${template.id}`}
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("drills.run.back")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={persist}
            disabled={fetcher.state !== "idle"}
          >
            {fetcher.state !== "idle" ? t("drills.run.saving") : t("drills.run.save")}
          </button>
          <button type="button" className={btnGhost} onClick={reset}>
            {t("drills.run.clearAll")}
          </button>
          <Link
            to={`/admin/print/drills/${template.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
          >
            <Printer className="w-4 h-4" />
            {t("drills.run.print")}
          </Link>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white">{template.name}</h1>
        <p className="text-white/50 text-sm mt-1">{t("drills.run.tap")}</p>
      </div>

      {concurrencyError && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-300 flex items-start gap-2">
          <span className="flex-shrink-0 mt-0.5">⚠</span>
          <span>
            {concurrencyError}{" "}
            <button
              type="button"
              className="underline hover:text-amber-200"
              onClick={() => {
                setConcurrencyError(null);
                revalidator.revalidate();
              }}
            >
              {t("drills.run.concurrencyReload")}
            </button>
          </span>
        </div>
      )}

      <ChecklistTable definition={def} state={state} onToggle={toggleCell} />

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-2">{t("drills.run.notesHeading")}</h2>
        <textarea
          value={state.notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full app-field"
          placeholder={t("drills.run.notesPlaceholder")}
        />
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-white">{t("drills.run.followUpHeading")}</h2>
          <button type="button" className={btnSecondary} onClick={addActionItem}>
            <Plus className="w-4 h-4 mr-1 inline" />
            {t("drills.run.addItem")}
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {state.actionItems.length === 0 ? (
            <li className="text-white/40 text-sm">{t("drills.run.noItems")}</li>
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
                  aria-label={item.done ? t("drills.run.markNotDone") : t("drills.run.markDone")}
                >
                  {item.done && <Check className="w-4 h-4" />}
                </button>
                <input
                  value={item.text}
                  onChange={(e) => updateActionItem(item.id, e.target.value)}
                  className="flex-1 min-w-[12rem] app-field"
                  placeholder={t("drills.run.itemPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => removeActionItem(item.id)}
                  className="p-2 text-rose-300 hover:bg-rose-500/10 rounded"
                  aria-label={t("drills.run.removeItem")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <button
        type="button"
        className={`${btnPrimary} self-start`}
        onClick={persist}
        disabled={fetcher.state !== "idle"}
      >
        {fetcher.state !== "idle" ? t("drills.run.saving") : t("drills.run.saveChecklist")}
      </button>
    </div>
  );
}
