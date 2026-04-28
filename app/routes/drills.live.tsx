import { Link, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { AlertTriangle, ArrowLeft, Check, Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/drills.live";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["roster", "admin"] };
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  cycleToggle,
  parseDrillAudience,
  parseDrillMode,
  parseRunState,
  parseTemplateDefinition,
  toggleKey,
  DRILL_MODES,
  DRILL_MODE_LABELS,
  type ClassroomAttestation,
  type DrillAudience,
  type DrillMode,
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
import { formatDrillEvent } from "~/domain/drills/replay";
import {
  broadcastDrillActivity,
  broadcastDrillEnded,
  broadcastDrillUpdate,
} from "~/lib/broadcast.server";
import { hasValidViewerAccess } from "~/domain/auth/viewer-access.server";
import { useDrillWebSocket } from "~/hooks/useDrillWebSocket";
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

  // Recent activity for the right-rail feed. We pull the last ~50 events
  // and join in actor display names so the panel can render without a
  // second round-trip. New events for the current session arrive over
  // the WebSocket; the loader only seeds the initial render.
  const rawEvents = await prisma.drillRunEvent.findMany({
    where: { runId: run.id },
    orderBy: { occurredAt: "desc" },
    take: 50,
  });
  const actorIds = Array.from(
    new Set(
      rawEvents
        .map((e) => e.actorUserId)
        .filter((v): v is string => typeof v === "string"),
    ),
  );
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const recentActivity = rawEvents
    .slice()
    .reverse() // chronological for display
    .map((ev) => {
      const a = ev.actorUserId ? actorById.get(ev.actorUserId) : null;
      return {
        id: ev.id,
        runId: ev.runId,
        kind: ev.kind,
        payload: ev.payload,
        actorUserId: ev.actorUserId,
        actorLabel: a ? (a.name?.trim() || a.email || null) : null,
        occurredAtIso: ev.occurredAt.toISOString(),
      };
    });

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
    me: {
      // Null on viewer-pin / anonymous; real user.id when signed in.
      userId: user?.id ?? null,
      // Always populated so the attestation overlay never has to render
      // "✓ undefined". Falls back to the viewer-pin label for guests.
      label: (user?.name || "").trim() || user?.email || "viewer",
    },
    recentActivity,
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
  const env = (context as { cloudflare?: { env: Env } }).cloudflare?.env;

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

  const actorLabel = (user.name?.trim() || user.email || null) ?? null;

  // Synthesize an activity payload for lifecycle events (paused/resumed/ended).
  // The DB row is canonical; this synthesized broadcast just lets connected
  // browsers see the event in the live activity feed without a refresh.
  // The synthetic id is fine — clients use it as a React key only, and a
  // page reload pulls the canonical rows from the loader.
  const synthEvent = (kind: string) => ({
    id: `synth-${kind}-${Date.now()}`,
    runId,
    kind,
    payload: { kind },
    actorUserId: user.id,
    actorLabel,
    occurredAtIso: new Date().toISOString(),
  });

  // Single try/catch so any unexpected throw (unique constraint, D1 hiccup,
  // bad JSON) surfaces to logs with actor + intent context. Response throws
  // (404/409/redirect) still propagate for React Router to handle.
  try {
    if (intent === "pause") {
      requireAdmin();
      const updated = await pauseDrillRun(prisma, org.id, runId, actor);
      if (env) {
        await broadcastDrillUpdate(env, org.id, {
          id: updated.id,
          status: "PAUSED",
          audience: updated.audience,
          state: updated.state,
          updatedAtIso: updated.updatedAt.toISOString(),
        });
        await broadcastDrillActivity(env, org.id, runId, [synthEvent("paused")]);
      }
      return dataWithSuccess(null, t("drillsLive.toasts.paused"));
    }

    if (intent === "resume") {
      requireAdmin();
      const updated = await resumeDrillRun(prisma, org.id, runId, actor);
      if (env) {
        await broadcastDrillUpdate(env, org.id, {
          id: updated.id,
          status: "LIVE",
          audience: updated.audience,
          state: updated.state,
          updatedAtIso: updated.updatedAt.toISOString(),
        });
        await broadcastDrillActivity(env, org.id, runId, [synthEvent("resumed")]);
      }
      return dataWithSuccess(null, t("drillsLive.toasts.resumed"));
    }

    if (intent === "end") {
      requireAdmin();
      // Optional end-time mode update — admin picks "Drill / Real event /
      // False alarm" when ending so the choice reflects what actually
      // happened (which is unknown at the moment of "Go Live"). Falls
      // back to the existing stored mode if absent or invalid.
      const rawMode = formData.get("mode");
      if (rawMode != null) {
        const mode = parseDrillMode(rawMode);
        await prisma.drillRun.update({
          where: { id: runId },
          data: { mode },
        });
      }
      await endDrillRun(prisma, org.id, runId, actor);
      if (env) {
        await broadcastDrillActivity(env, org.id, runId, [synthEvent("ended")]);
        await broadcastDrillEnded(env, org.id, runId);
      }
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
      const { run: updated, events } = await updateLiveRunState(
        prisma,
        org.id,
        runId,
        next,
        actor,
      );
      if (env) {
        await broadcastDrillUpdate(env, org.id, {
          id: updated.id,
          status: updated.status as "LIVE" | "PAUSED" | "ENDED",
          audience: updated.audience,
          state: updated.state,
          updatedAtIso: updated.updatedAt.toISOString(),
        });
        if (events.length > 0) {
          await broadcastDrillActivity(
            env,
            org.id,
            runId,
            events.map((ev) => ({
              id: ev.id,
              runId: ev.runId,
              kind: ev.kind,
              payload: ev.payload,
              actorUserId: ev.actorUserId,
              actorLabel,
              occurredAtIso: ev.occurredAt.toISOString(),
            })),
          );
        }
      }
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

// Stable per-user color from a simple hash of userId. Same user always gets
// the same color across reloads / browsers, so presence pills are
// recognizable.
function userColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 70% 60%)`;
}

type PresenceFocus =
  | { kind: "notes" }
  | { kind: "item"; id: string }
  | null;

type PresenceEntry = {
  userId: string;
  label: string;
  color: string;
  focus: PresenceFocus;
  at: number; // ms epoch
};

type ActivityEntry = {
  id: string;
  runId: string;
  kind: string;
  payload: unknown;
  actorUserId: string | null;
  actorLabel: string | null;
  occurredAtIso: string;
};

const PRESENCE_TTL_MS = 8000;
const PRESENCE_HEARTBEAT_MS = 3000;
const AUTOSAVE_DEBOUNCE_MS = 1000;

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
  const { t: tAdmin } = useTranslation("admin");
  const { run, template, isAdmin, paused, me, recentActivity } = loaderData;
  const def = useMemo(() => parseTemplateDefinition(template.definition), [template.definition]);
  const [state, setState] = useState<RunState>(() => parseRunState(run.state));
  const fetcher = useFetcher();
  const [elapsed, setElapsed] = useState(() => formatElapsed(run.activatedAtIso));
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>(
    () => recentActivity as ActivityEntry[],
  );
  const [presence, setPresence] = useState<Map<string, PresenceEntry>>(new Map());

  // Refs that the WS-driven smart-merge consults so it doesn't clobber
  // text the user is currently typing. Last-write-wins on persist, but the
  // typing-side experience never sees its own keystrokes vanish.
  const notesFocusedRef = useRef(false);
  const notesDirtyRef = useRef(false);
  const focusedItemIdRef = useRef<string | null>(null);
  const dirtyItemTextRef = useRef<Set<string>>(new Set());

  // Latest committed state — used by debounced auto-save callbacks so they
  // see fresh data without restarting the timer on every keystroke.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Pending debounced save handles, by source. One for notes, one per item.
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

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

  // Smart merge: server state wins for everything *except* fields the local
  // user is currently typing into. Fields with focus or unsaved keystrokes
  // hold the local value. Item identity is by stable id; new items from
  // either side are preserved in a stable order.
  //
  // This is intentionally last-write-wins for *unfocused* content (a save by
  // someone else replaces our cached copy). Live typers see the divergence
  // only when they blur, at which point their pending save lands and the
  // server's view becomes consistent again.
  const smartMerge = useCallback((local: RunState, incoming: RunState): RunState => {
    const localItemMap = new Map(local.actionItems.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const merged = incoming.actionItems.map((srv) => {
      seen.add(srv.id);
      const lcl = localItemMap.get(srv.id);
      if (!lcl) return srv;
      const isFocused = focusedItemIdRef.current === srv.id;
      const isDirty = dirtyItemTextRef.current.has(srv.id);
      return {
        ...srv,
        text: isFocused || isDirty ? lcl.text : srv.text,
      };
    });
    for (const lcl of local.actionItems) {
      if (!seen.has(lcl.id)) merged.push(lcl);
    }
    return {
      toggles: incoming.toggles,
      classroomAttestations: incoming.classroomAttestations,
      notes:
        notesFocusedRef.current || notesDirtyRef.current
          ? local.notes
          : incoming.notes,
      actionItems: merged,
    };
  }, []);

  // Re-sync local state whenever the loader returns a new revision (initial
  // mount, or after our own action revalidates). Goes through smartMerge so
  // an open notes textarea isn't blown away on revalidation.
  useEffect(() => {
    const incoming = parseRunState(run.state);
    setState((local) => smartMerge(local, incoming));
  }, [run.id, run.updatedAtIso, run.state, smartMerge]);

  // Reset activity buffer whenever the loader returns a fresh server-side
  // snapshot — keeps client and server tightly aligned across navigations
  // and reconnects.
  useEffect(() => {
    setActivity(recentActivity as ActivityEntry[]);
  }, [run.id, recentActivity]);

  // Tick the elapsed clock every second while LIVE. Stop while paused so the
  // banner clearly reflects the freeze.
  useEffect(() => {
    if (paused) return;
    const i = setInterval(() => {
      setElapsed(formatElapsed(run.activatedAtIso));
    }, 1000);
    return () => clearInterval(i);
  }, [paused, run.activatedAtIso]);

  // Drop expired presence entries on a 1s interval so stale "is editing"
  // pills disappear when someone closes a tab.
  useEffect(() => {
    const i = setInterval(() => {
      setPresence((m) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(m);
        for (const [k, v] of m) {
          if (now - v.at > PRESENCE_TTL_MS) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : m;
      });
    }, 1000);
    return () => clearInterval(i);
  }, []);

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

  // Persist now, clearing any pending debounced timer for the same source.
  const flushNotesDebounce = useCallback(() => {
    if (notesDebounceRef.current !== null) {
      clearTimeout(notesDebounceRef.current);
      notesDebounceRef.current = null;
    }
  }, []);
  const flushItemDebounce = useCallback((id: string) => {
    const handle = itemDebounceRef.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      itemDebounceRef.current.delete(id);
    }
  }, []);

  // ---- WebSocket: subscribe and merge --------------------------------------
  const ws = useDrillWebSocket({
    runId: run.id,
    onUpdate: (msg) => {
      const incomingState = parseRunState(msg.run.state as Prisma.JsonValue);
      // Skip if the server's view is older than what we already have (can
      // happen when our own save's broadcast races our fetcher revalidation).
      if (msg.run.updatedAtIso < run.updatedAtIso) return;
      setState((local) => smartMerge(local, incomingState));
      setLastSavedAt(Date.now());
    },
    onActivity: (msg) => {
      setActivity((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const additions = msg.events.filter((e) => !ids.has(e.id));
        if (additions.length === 0) return prev;
        const next = [...prev, ...additions];
        // Cap to last 200 to keep the panel bounded during a long drill.
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    },
    onPresence: (msg) => {
      // Don't render self in the pill list.
      if (me.userId && msg.userId === me.userId) return;
      setPresence((m) => {
        const next = new Map(m);
        if (msg.focus === null) {
          next.delete(msg.userId);
        } else {
          next.set(msg.userId, {
            userId: msg.userId,
            label: msg.label,
            color: msg.color,
            focus: msg.focus,
            at: Date.now(),
          });
        }
        return next;
      });
    },
    onEnded: () => {
      // Server will redirect us anyway on the next loader hit; force it now.
      window.location.assign("/");
    },
  });

  // ---- presence broadcasting ----------------------------------------------
  const sendPresence = useCallback(
    (focus: PresenceFocus) => {
      if (!me.userId) return; // viewer-pin guests don't broadcast
      ws.send({
        type: "drillPresence",
        runId: run.id,
        userId: me.userId,
        label: me.label,
        color: userColor(me.userId),
        focus,
        at: new Date().toISOString(),
      });
    },
    [me.userId, me.label, run.id, ws],
  );

  // Heartbeat: while a field is focused, re-broadcast presence every 3s so
  // it doesn't expire on watchers. The current focus is held in a ref-style
  // state so the timer always sees the latest value.
  const currentFocusRef = useRef<PresenceFocus>(null);
  useEffect(() => {
    const i = setInterval(() => {
      if (currentFocusRef.current !== null) {
        sendPresence(currentFocusRef.current);
      }
    }, PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(i);
  }, [sendPresence]);

  const setFocus = useCallback(
    (focus: PresenceFocus) => {
      currentFocusRef.current = focus;
      sendPresence(focus);
    },
    [sendPresence],
  );

  // ---- editing handlers ----------------------------------------------------
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

  // Notes typing: update local state + mark dirty + schedule a debounced
  // save so other browsers see the text within ~1s of the last keystroke.
  const setNotes = useCallback(
    (notes: string) => {
      if (readOnly) return;
      notesDirtyRef.current = true;
      setState((s) => ({ ...s, notes }));
      flushNotesDebounce();
      notesDebounceRef.current = setTimeout(() => {
        notesDebounceRef.current = null;
        notesDirtyRef.current = false;
        persist(stateRef.current);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [persist, readOnly, flushNotesDebounce],
  );

  const flushNotes = useCallback(() => {
    if (readOnly) return;
    flushNotesDebounce();
    notesDirtyRef.current = false;
    persist(stateRef.current);
  }, [persist, readOnly, flushNotesDebounce]);

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
      dirtyItemTextRef.current.add(id);
      setState((s) => ({
        ...s,
        actionItems: s.actionItems.map((a) => (a.id === id ? { ...a, text } : a)),
      }));
      flushItemDebounce(id);
      const handle = setTimeout(() => {
        itemDebounceRef.current.delete(id);
        dirtyItemTextRef.current.delete(id);
        persist(stateRef.current);
      }, AUTOSAVE_DEBOUNCE_MS);
      itemDebounceRef.current.set(id, handle);
    },
    [persist, readOnly, flushItemDebounce],
  );

  const flushActionItem = useCallback(
    (id: string) => {
      if (readOnly) return;
      flushItemDebounce(id);
      dirtyItemTextRef.current.delete(id);
      persist(stateRef.current);
    },
    [persist, readOnly, flushItemDebounce],
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
      flushItemDebounce(id);
      dirtyItemTextRef.current.delete(id);
      setState((s) => {
        const next: RunState = {
          ...s,
          actionItems: s.actionItems.filter((a) => a.id !== id),
        };
        persist(next);
        return next;
      });
    },
    [persist, readOnly, flushItemDebounce],
  );

  // --- attestation handlers ----------------------------------------------
  // Each click immediately persists so other phones see the row turn green
  // (or amber) within a single revalidation. byUserId / byLabel come from
  // the loader so attribution survives reload.
  const attestRow = useCallback(
    (rowId: string, status: "all-clear" | "issue", note?: string) => {
      if (readOnly) return;
      setState((s) => {
        const entry: ClassroomAttestation = {
          byUserId: me.userId,
          byLabel: me.label,
          attestedAt: new Date().toISOString(),
          status,
        };
        if (note && note.length > 0) entry.note = note;
        const nextState: RunState = {
          ...s,
          classroomAttestations: { ...s.classroomAttestations, [rowId]: entry },
        };
        persist(nextState);
        return nextState;
      });
    },
    [me.label, me.userId, persist, readOnly],
  );

  const unattestRow = useCallback(
    (rowId: string) => {
      if (readOnly) return;
      setState((s) => {
        if (!(rowId in s.classroomAttestations)) return s;
        const next = { ...s.classroomAttestations };
        delete next[rowId];
        const nextState: RunState = { ...s, classroomAttestations: next };
        persist(nextState);
        return nextState;
      });
    },
    [persist, readOnly],
  );

  // Group presence entries by focus location so each pill renders next to
  // the right field without a quadratic scan in the JSX.
  const presenceByFocus = useMemo(() => {
    const notes: PresenceEntry[] = [];
    const itemMap = new Map<string, PresenceEntry[]>();
    for (const p of presence.values()) {
      if (p.focus?.kind === "notes") notes.push(p);
      else if (p.focus?.kind === "item") {
        const arr = itemMap.get(p.focus.id) ?? [];
        arr.push(p);
        itemMap.set(p.focus.id, arr);
      }
    }
    return { notes, itemMap };
  }, [presence]);

  // Aggregate summary at top of run page.
  // Heuristic: roomCount = template rows whose sectionId is "class-roll" if
  // any rows use that section, else all rows. TODO: revisit once templates
  // can mark which rows count as classrooms explicitly.
  const totalRooms = useMemo(() => {
    const classRollRows = def.rows.filter((r) => r.sectionId === "class-roll");
    return classRollRows.length > 0 ? classRollRows.length : def.rows.length;
  }, [def.rows]);
  const attestedCount = Object.keys(state.classroomAttestations).length;
  const issuesCount = Object.values(state.classroomAttestations).filter(
    (a) => a.status === "issue",
  ).length;

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

          <p
            className="-mt-3 inline-flex items-center gap-2 rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 self-start"
            aria-live="polite"
          >
            {t("drillsLive.attest.summary", {
              attested: attestedCount,
              total: totalRooms,
              issues: issuesCount,
            })}
          </p>

          <ChecklistTable
            definition={def}
            state={state}
            onToggle={toggleCell}
            readOnly={readOnly}
            attestation={{
              attestations: state.classroomAttestations,
              onAttest: attestRow,
              onUnattest: unattestRow,
              labels: {
                columnHeader: t("drillsLive.attest.columnHeader"),
                attest: t("drillsLive.attest.attest"),
                issue: t("drillsLive.attest.issue"),
                undo: t("drillsLive.attest.undo"),
                issueNotePlaceholder: t("drillsLive.attest.issueNotePlaceholder"),
                issueNoteSave: t("drillsLive.attest.issueNoteSave"),
                attestedBy: t("drillsLive.attest.attestedBy"),
              },
            }}
          />

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-semibold text-white">{t("drillsLive.notesHeading")}</h2>
              {presenceByFocus.notes.length > 0 && (
                <PresencePill people={presenceByFocus.notes} t={t} />
              )}
            </div>
            <textarea
              value={state.notes}
              onChange={(e) => setNotes(e.target.value)}
              onFocus={() => {
                notesFocusedRef.current = true;
                setFocus({ kind: "notes" });
              }}
              onBlur={() => {
                notesFocusedRef.current = false;
                setFocus(null);
                flushNotes();
              }}
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
                state.actionItems.map((item) => {
                  const itemPresence = presenceByFocus.itemMap.get(item.id) ?? [];
                  return (
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
                        onFocus={() => {
                          focusedItemIdRef.current = item.id;
                          setFocus({ kind: "item", id: item.id });
                        }}
                        onBlur={() => {
                          focusedItemIdRef.current = null;
                          setFocus(null);
                          flushActionItem(item.id);
                        }}
                        disabled={readOnly}
                        className="flex-1 min-w-[12rem] app-field disabled:opacity-60 disabled:cursor-not-allowed"
                        placeholder={t("drillsLive.followUpPlaceholder")}
                      />
                      {itemPresence.length > 0 && (
                        <PresenceDots people={itemPresence} />
                      )}
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
                  );
                })
              )}
            </ul>
          </section>
        </main>

        {me.userId && (
          <aside className="xl:w-80 xl:flex-shrink-0 flex flex-col gap-4 sticky top-6 self-start">
            {isAdmin && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
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

                <EndDrillPopover runId={run.id} t={t} tAdmin={tAdmin} />

                {template.authority && (
                  <p className="text-[11px] text-white/40 mt-2">
                    {t("drillsLive.source", { authority: template.authority })}
                  </p>
                )}
              </div>
            )}

            <ActivityPanel events={activity} t={t} tAdmin={tAdmin} />
          </aside>
        )}
      </div>
    </div>
  );
}

type Translator = (key: string, opts?: Record<string, unknown>) => string;

function PresencePill({ people, t }: { people: PresenceEntry[]; t: Translator }) {
  const head = people[0];
  if (!head) return null;
  const extra = people.length - 1;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-white/80"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full animate-pulse"
        style={{ backgroundColor: head.color }}
      />
      {extra > 0
        ? t("drillsLive.presence.editingMany", {
            label: head.label,
            count: extra,
            defaultValue: `${head.label} + ${extra} editing`,
          })
        : t("drillsLive.presence.editing", {
            label: head.label,
            defaultValue: `${head.label} is editing…`,
          })}
    </span>
  );
}

function PresenceDots({ people }: { people: PresenceEntry[] }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {people.slice(0, 3).map((p) => (
        <span
          key={p.userId}
          title={p.label}
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: p.color }}
        />
      ))}
    </span>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function ActivityPanel({
  events,
  t,
  tAdmin,
}: {
  events: ActivityEntry[];
  t: Translator;
  tAdmin: Translator;
}) {
  // Reverse so newest is on top.
  const ordered = useMemo(() => events.slice().reverse(), [events]);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
      <div className="text-xs uppercase tracking-wide text-white/50 font-semibold sticky top-0 bg-[#181c1c]/80 backdrop-blur -mx-1 px-1 py-1">
        {t("drillsLive.activityHeading", { defaultValue: "Activity" })}
      </div>
      {ordered.length === 0 ? (
        <p className="text-white/40 text-xs">
          {t("drillsLive.activityEmpty", { defaultValue: "No activity yet." })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((ev) => {
            // formatDrillEvent expects a typed payload but the wire shape is
            // unknown JSON. Cast to the formatter's expected shape; if a kind
            // we don't recognize comes through, the formatter falls back to
            // the raw kind string via its defaultValue path.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = formatDrillEvent(ev.payload as any, tAdmin);
            return (
              <li key={ev.id} className="text-xs text-white/80 leading-snug">
                <span className="font-medium text-white">
                  {ev.actorLabel ?? t("drillsLive.activityUnknownActor", {
                    defaultValue: "Someone",
                  })}
                </span>{" "}
                <span className="text-white/70">{text}</span>{" "}
                <span className="text-white/40 whitespace-nowrap">· {relativeTime(ev.occurredAtIso)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EndDrillPopover({
  runId,
  t,
  tAdmin,
}: {
  runId: string;
  t: Translator;
  tAdmin: Translator;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DrillMode>("DRILL");
  const fetcher = useFetcher();
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <button type="button" className={`${btnDanger} w-full`}>
          <Square className="w-4 h-4 mr-1" />
          {t("drillsLive.end")}
        </button>
      </PopoverTrigger>
      <PopoverContent placement="bottom end" className="p-0">
        <fetcher.Form method="post" className="flex flex-col gap-3 p-4 w-72">
          <input type="hidden" name="intent" value="end" />
          <input type="hidden" name="runId" value={runId} />
          <div>
            <h3 className="text-sm font-semibold">
              {t("drillsLive.endPopover.heading", {
                defaultValue: "End drill",
              })}
            </h3>
            <p className="text-xs text-white/60 mt-0.5">
              {t("drillsLive.endPopover.subhead", {
                defaultValue: "How should this be recorded in the history?",
              })}
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            {DRILL_MODES.map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span>
                  {tAdmin(
                    m === "DRILL"
                      ? "drills.mode.drill"
                      : m === "ACTUAL"
                        ? "drills.mode.actual"
                        : "drills.mode.falseAlarm",
                    { defaultValue: DRILL_MODE_LABELS[m] },
                  )}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="text-sm text-white/60 hover:text-white px-2"
              onClick={() => setOpen(false)}
            >
              {t("drillsLive.endPopover.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              type="submit"
              className={btnDanger}
              disabled={fetcher.state !== "idle"}
            >
              <Square className="w-3.5 h-3.5 mr-1" />
              {t("drillsLive.endPopover.confirm", { defaultValue: "End drill" })}
            </button>
          </div>
        </fetcher.Form>
      </PopoverContent>
    </Popover>
  );
}
