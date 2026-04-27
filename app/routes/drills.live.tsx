import { Form, Link, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Check, Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/drills.live";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["roster"] };
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  cycleToggle,
  parseDrillAudience,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
  type DrillAudience,
  type RunState,
} from "~/domain/drills/types";
import { ChecklistTable } from "~/domain/drills/ChecklistTable";
import {
  endDrillRun,
  getActiveDrillRun,
  pauseDrillRun,
  resumeDrillRun,
  updateLiveRunState,
} from "~/domain/drills/live.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import type { Prisma } from "~/db";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.metaTitle ?? "Live drill",
  },
];

const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnDanger =
  "inline-flex items-center justify-center rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "roster");

  // Compute membership: STAFF if signed-in user; else VIEWER_PIN if a valid
  // viewer cookie is present; else not allowed at all.
  let membership: "STAFF" | "VIEWER_PIN" | null = null;
  if (user) {
    membership = "STAFF";
  } else if (await hasValidViewerAccess({ request, context })) {
    membership = "VIEWER_PIN";
  }
  if (membership === null) {
    throw new Response("Not authenticated", { status: 401 });
  }

  let run;
  try {
    run = await getActiveDrillRun(prisma, org.id);
  } catch (err) {
    console.error(
      `[drills.live] loader getActiveDrillRun threw (org=${org.id})`,
      err,
    );
    throw err;
  }
  if (!run) {
    throw redirect("/");
  }

  const audience: DrillAudience = parseDrillAudience(run.audience);

  // Audience gate: viewer-pin guests can only see EVERYONE drills. 404 (not
  // 401) because logging in won't change the answer for them.
  if (membership === "VIEWER_PIN" && audience === "STAFF_ONLY") {
    throw new Response("Not found", { status: 404 });
  }

  // Admin = signed-in user with ADMIN/CONTROLLER role. Used purely for showing
  // the admin sidebar (pause/resume/end). Inlined here to avoid resurrecting
  // the deleted `userIsAdmin` helper just for one call site.
  const isAdmin =
    !!user && (user.role === "ADMIN" || user.role === "CONTROLLER");

  const paused = run.status === "PAUSED";
  const metaTitle = paused
    ? t("drillsLive.metaPaused", { name: run.template.name })
    : t("drillsLive.metaLive", { name: run.template.name });

  return {
    run: {
      id: run.id,
      status: run.status as "LIVE" | "PAUSED",
      activatedAtIso: run.activatedAt?.toISOString() ?? null,
      pausedAtIso: run.pausedAt?.toISOString() ?? null,
      state: run.state,
      updatedAtIso: run.updatedAt.toISOString(),
      audience,
    },
    template: {
      id: run.template.id,
      name: run.template.name,
      drillType: run.template.drillType,
      authority: run.template.authority,
      instructions: run.template.instructions,
      definition: run.template.definition,
    },
    isAdmin,
    paused,
    userName: user?.name || user?.email || "viewer",
    metaTitle,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) {
    throw new Response("Not authenticated", { status: 401 });
  }
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const isAdmin = user.role === "ADMIN" || user.role === "CONTROLLER";
  const actor = getActorIdsFromContext(context);

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "roster");

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const runId = String(formData.get("runId") ?? "");

  if (!runId) {
    return dataWithError(null, t("drillsLive.errors.missingRunId"));
  }

  const requireAdmin = () => {
    if (!isAdmin) {
      throw new Response("Forbidden", { status: 403 });
    }
  };

  // Single try/catch so any unexpected throw (unique constraint, D1 hiccup,
  // bad JSON) surfaces to logs with actor + intent context. Response throws
  // (404/409/redirect) still propagate for React Router to handle.
  try {
    if (intent === "pause") {
      requireAdmin();
      await pauseDrillRun(prisma, org.id, runId, actor);
      return dataWithSuccess(null, t("drillsLive.toasts.paused"));
    }

    if (intent === "resume") {
      requireAdmin();
      await resumeDrillRun(prisma, org.id, runId, actor);
      return dataWithSuccess(null, t("drillsLive.toasts.resumed"));
    }

    if (intent === "end") {
      requireAdmin();
      await endDrillRun(prisma, org.id, runId, actor);
      // After ending, the user no longer needs the takeover. Send them home.
      throw redirect("/");
    }

    if (intent === "update-state") {
      const raw = String(formData.get("state") ?? "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return dataWithError(null, t("drillsLive.errors.invalidStateJson"));
      }
      const next = parseRunState(parsed as Prisma.JsonValue);
      await updateLiveRunState(prisma, org.id, runId, next, actor);
      // No toast — the page renders an inline "Saving…/Saved" indicator
      // instead. Returning a non-null body so fetcher.data signals
      // success to the client.
      return { ok: true };
    }

    return dataWithError(null, t("drillsLive.errors.unknownAction"));
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error(
      `[drills.live] action intent=${intent} runId=${runId} user=${user.id} threw`,
      err,
    );
    const msg = err instanceof Error ? err.message : t("drillsLive.errors.unexpected");
    return dataWithError(null, msg, { status: 500 });
  }
}

function newId(): string {
  return crypto.randomUUID();
}

function formatElapsed(startIso: string | null): string {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) {
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DrillsLivePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("roster");
  const { run, template, isAdmin, paused } = loaderData;
  const def = useMemo(() => parseTemplateDefinition(template.definition), [template.definition]);
  const [state, setState] = useState<RunState>(() => parseRunState(run.state));
  const fetcher = useFetcher();
  const [elapsed, setElapsed] = useState(() => formatElapsed(run.activatedAtIso));
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // When a save succeeds (fetcher returns idle with non-error data), stamp
  // "lastSavedAt" so the inline indicator shows "Saved · just now" briefly.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !("error" in fetcher.data)) {
      setLastSavedAt(Date.now());
    }
  }, [fetcher.state, fetcher.data]);

  // Auto-clear the saved indicator after 1500ms.
  useEffect(() => {
    if (lastSavedAt === null) return;
    const id = setTimeout(() => setLastSavedAt(null), 1500);
    return () => clearTimeout(id);
  }, [lastSavedAt]);

  const saveStatus: "idle" | "saving" | "saved" =
    fetcher.state !== "idle"
      ? "saving"
      : lastSavedAt !== null
        ? "saved"
        : "idle";

  // Re-sync local state whenever the loader returns a new revision (e.g. after
  // a successful save the fetcher revalidates and we mirror it back).
  useEffect(() => {
    setState(parseRunState(run.state));
  }, [run.id, run.updatedAtIso, run.state]);

  // Tick the elapsed clock every second while LIVE. Stop while paused so the
  // banner clearly reflects the freeze.
  useEffect(() => {
    if (paused) return;
    const i = setInterval(() => {
      setElapsed(formatElapsed(run.activatedAtIso));
    }, 1000);
    return () => clearInterval(i);
  }, [paused, run.activatedAtIso]);

  const readOnly = paused;

  const persist = useCallback(
    (next: RunState) => {
      if (readOnly) return;
      const fd = new FormData();
      fd.set("intent", "update-state");
      fd.set("runId", run.id);
      fd.set("state", JSON.stringify(next));
      fetcher.submit(fd, { method: "post" });
    },
    [fetcher, readOnly, run.id],
  );

  const toggleCell = useCallback(
    (rowId: string, colId: string) => {
      if (readOnly) return;
      const key = toggleKey(rowId, colId);
      setState((s) => {
        const nextVal = cycleToggle(s.toggles[key]);
        const toggles = { ...s.toggles };
        if (nextVal === null) {
          delete toggles[key];
        } else {
          toggles[key] = nextVal;
        }
        const next: RunState = { ...s, toggles };
        persist(next);
        return next;
      });
    },
    [persist, readOnly],
  );

  const setNotes = useCallback(
    (notes: string) => {
      if (readOnly) return;
      setState((s) => ({ ...s, notes }));
    },
    [readOnly],
  );

  const flushNotes = useCallback(() => {
    if (readOnly) return;
    persist(state);
  }, [persist, readOnly, state]);

  const addActionItem = useCallback(() => {
    if (readOnly) return;
    setState((s) => {
      const next: RunState = {
        ...s,
        actionItems: [...s.actionItems, { id: newId(), text: "", done: false }],
      };
      persist(next);
      return next;
    });
  }, [persist, readOnly]);

  const updateActionItem = useCallback(
    (id: string, text: string) => {
      if (readOnly) return;
      setState((s) => ({
        ...s,
        actionItems: s.actionItems.map((a) => (a.id === id ? { ...a, text } : a)),
      }));
    },
    [readOnly],
  );

  const toggleActionDone = useCallback(
    (id: string) => {
      if (readOnly) return;
      setState((s) => {
        const next: RunState = {
          ...s,
          actionItems: s.actionItems.map((a) =>
            a.id === id ? { ...a, done: !a.done } : a,
          ),
        };
        persist(next);
        return next;
      });
    },
    [persist, readOnly],
  );

  const removeActionItem = useCallback(
    (id: string) => {
      if (readOnly) return;
      setState((s) => {
        const next: RunState = {
          ...s,
          actionItems: s.actionItems.filter((a) => a.id !== id),
        };
        persist(next);
        return next;
      });
    },
    [persist, readOnly],
  );

  const bannerClass = paused
    ? "bg-amber-500/15 border-amber-400/50 text-amber-100"
    : "bg-rose-600/15 border-rose-500/60 text-rose-100";

  return (
    <div className="min-h-screen bg-[#181c1c] flex flex-col">
      <div
        className={`w-full border-b ${bannerClass} px-4 py-3 flex flex-wrap items-center gap-3`}
        role="status"
        aria-live="polite"
      >
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <div className="text-sm font-bold uppercase tracking-wide">
            {paused ? t("drillsLive.bannerPaused") : t("drillsLive.bannerLive")}
            {" — "}
            <span className="font-semibold normal-case">{template.name}</span>
          </div>
          {template.instructions && (
            <p className="text-xs opacity-80 mt-0.5">{template.instructions}</p>
          )}
        </div>
        <div className="text-sm font-mono tabular-nums">
          {paused ? t("drillsLive.elapsedFrozen") : t("drillsLive.elapsedRunning")} {elapsed}
        </div>
        <span className="ml-2 inline-flex items-center rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {t("drillsLive.audienceBadge", {
            label:
              run.audience === "STAFF_ONLY"
                ? t("drillsLive.audience.staffOnly")
                : t("drillsLive.audience.everyone"),
          })}
        </span>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row gap-6 p-6 max-w-[1400px] w-full mx-auto">
        <main className="flex-1 min-w-0 flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{template.name}</h1>
              <p className="text-white/50 text-sm mt-1">
                {paused
                  ? t("drillsLive.subtitlePaused")
                  : t("drillsLive.subtitleLive")}
              </p>
            </div>
            {isAdmin && (
              <Link to="/admin/drills" className={btnGhost}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                {t("drillsLive.adminLink")}
              </Link>
            )}
          </div>

          <div className="flex items-center justify-end h-5 -mb-2 text-xs">
            {saveStatus === "saving" && (
              <span className="text-white/50 inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse"
                />
                {t("drillsLive.savedIndicator.saving")}
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-emerald-300/80">
                {t("drillsLive.savedIndicator.saved")}
              </span>
            )}
          </div>

          <ChecklistTable
            definition={def}
            state={state}
            onToggle={toggleCell}
            readOnly={readOnly}
          />

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-2">{t("drillsLive.notesHeading")}</h2>
            <textarea
              value={state.notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={flushNotes}
              rows={4}
              disabled={readOnly}
              className="w-full app-field disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder={t("drillsLive.notesPlaceholder")}
            />
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-white">{t("drillsLive.followUpHeading")}</h2>
              {!readOnly && (
                <button type="button" className={btnSecondary} onClick={addActionItem}>
                  <Plus className="w-4 h-4 mr-1 inline" />
                  {t("drillsLive.addFollowUp")}
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {state.actionItems.length === 0 ? (
                <li className="text-white/40 text-sm">{t("drillsLive.noFollowUp")}</li>
              ) : (
                state.actionItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleActionDone(item.id)}
                      disabled={readOnly}
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border ${
                        item.done
                          ? "border-emerald-500 bg-emerald-600/30 text-emerald-200"
                          : "border-white/20 bg-white/5 text-white/40"
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                      aria-pressed={item.done}
                      aria-label={item.done ? t("drillsLive.markNotDone") : t("drillsLive.markDone")}
                    >
                      {item.done && <Check className="w-4 h-4" />}
                    </button>
                    <input
                      value={item.text}
                      onChange={(e) => updateActionItem(item.id, e.target.value)}
                      onBlur={flushNotes}
                      disabled={readOnly}
                      className="flex-1 min-w-[12rem] app-field disabled:opacity-60 disabled:cursor-not-allowed"
                      placeholder={t("drillsLive.followUpPlaceholder")}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removeActionItem(item.id)}
                        className="p-2 text-rose-300 hover:bg-rose-500/10 rounded"
                        aria-label={t("drillsLive.removeItem")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>
        </main>

        {isAdmin && (
          <aside className="xl:w-72 xl:flex-shrink-0">
            <div className="sticky top-6 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
              <div className="text-xs uppercase tracking-wide text-white/50 font-semibold">
                {t("drillsLive.adminControls")}
              </div>
              <p className="text-xs text-white/50">
                {t("drillsLive.adminHelper")}
              </p>

              {paused ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="resume" />
                  <input type="hidden" name="runId" value={run.id} />
                  <button
                    type="submit"
                    className={`${btnPrimary} w-full`}
                    disabled={fetcher.state !== "idle"}
                  >
                    <Play className="w-4 h-4 mr-1" />
                    {t("drillsLive.resume")}
                  </button>
                </fetcher.Form>
              ) : (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="pause" />
                  <input type="hidden" name="runId" value={run.id} />
                  <button
                    type="submit"
                    className={`${btnSecondary} w-full`}
                    disabled={fetcher.state !== "idle"}
                  >
                    <Pause className="w-4 h-4 mr-1" />
                    {t("drillsLive.pause")}
                  </button>
                </fetcher.Form>
              )}

              <Form
                method="post"
                onSubmit={(e) => {
                  if (!confirm(t("drillsLive.endConfirm"))) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="intent" value="end" />
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className={`${btnDanger} w-full`}>
                  <Square className="w-4 h-4 mr-1" />
                  {t("drillsLive.end")}
                </button>
              </Form>

              {template.authority && (
                <p className="text-[11px] text-white/40 mt-2">
                  {t("drillsLive.source", { authority: template.authority })}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
