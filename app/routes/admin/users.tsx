import { Form, Link, useFetcher, useSearchParams } from "react-router";
import { Button, Input } from "@heroui/react";
import {
  Ban,
  KeyRound,
  Link as LinkIcon,
  LogIn,
  Mail,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  ShieldX,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/users";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getPrisma } from "~/db.server";
import { getAuth, hashPassword } from "~/domain/auth/better-auth.server";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import {
  createViewerMagicLink,
  resetViewerLock,
  revokeAllViewerSessions,
  setViewerPin,
} from "~/domain/auth/viewer-access.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  handleAdminUsersAction,
  loadAdminUsersData,
  requireTargetInOrg,
  type AdminUsersActionOutcome,
  type AdminUsersFetcherData,
} from "~/domain/admin-users/admin-users.server";
import {
  inviteUser,
  type InviteUserError,
} from "~/domain/admin-users/invite-user.server";
import {
  findLinkedHouseholdsForUser,
  findPendingInviteByUser,
  loadLastActiveByUser,
  loadPendingInviteIdsForOrg,
  loadRecentActivity,
  loadUserSessions,
  type UserActivityEntry,
  type UserHouseholdLink,
  type UserSessionInfo,
} from "~/domain/admin-users/user-details.server";
import { assertNotAlreadyImpersonating } from "~/domain/auth/impersonate-gate.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import type { TFunction } from "i18next";
import { EntityAvatar, deriveInitials } from "~/components/admin/EntityAvatar";
import { StatusPill, type PillTone } from "~/components/admin/StatusPill";
import { EntityLink } from "~/components/admin/EntityLink";
import { SectionHeader } from "~/components/admin/SectionHeader";
import { StatCard } from "~/components/admin/StatCard";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Users" },
];

const ROLE_OPTIONS = ["ADMIN", "CONTROLLER", "VIEWER"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

const SORT_OPTIONS = ["lastActive", "name", "role", "created"] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

const ROLE_FILTER_OPTIONS = ["ALL", "ADMIN", "CONTROLLER", "VIEWER", "PENDING"] as const;
type RoleFilter = (typeof ROLE_FILTER_OPTIONS)[number];

export async function loader({ request, context }: Route.LoaderArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const tenantPrisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const data = await loadAdminUsersData({
    prisma,
    tenantPrisma,
    org,
    currentUserId: me.id,
  });
  const userIds = data.users.map((u) => u.id);
  const [lastActiveMap, pendingInviteIds, householdsForCurrentUser, locale] = await Promise.all([
    loadLastActiveByUser(prisma, userIds),
    loadPendingInviteIdsForOrg(prisma, userIds),
    // Pre-load household options once (for invite drawer).
    prisma.household.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    detectLocale(request, context),
  ]);

  const usersWithMeta = data.users.map((user) => {
    const last = lastActiveMap.get(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      createdAt:
        user.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : String(user.createdAt),
      lastActiveAt: last?.lastActiveAt ?? null,
      sessionCount: last?.sessionCount ?? 0,
      pending: pendingInviteIds.has(user.id),
    };
  });

  const locksSerialized = data.locks.map((lock) => ({
    clientKey: lock.clientKey,
    ipHint: lock.ipHint,
    requiresAdminReset: lock.requiresAdminReset,
    lockedUntil:
      lock.lockedUntil instanceof Date
        ? lock.lockedUntil.toISOString()
        : lock.lockedUntil
        ? String(lock.lockedUntil)
        : null,
  }));
  const t = await getFixedT(locale, "admin");
  return {
    users: usersWithMeta,
    locks: locksSerialized,
    currentUserId: me.id,
    passwordResetEnabled: data.passwordResetEnabled,
    households: householdsForCurrentUser,
    metaTitle: t("users.metaTitle"),
  };
}

function dataWithToast(outcome: AdminUsersActionOutcome, t: TFunction) {
  const message = t(outcome.message.key, outcome.message.params ?? {});
  if (outcome.kind === "success") return dataWithSuccess(outcome.data, message);
  if (outcome.kind === "warning") return dataWithWarning(outcome.data, message);
  return dataWithError(outcome.data, message);
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const actor = getActorIdsFromContext(context);
  const prisma = getPrisma(context);
  const auth = getAuth(context);
  const formData = await request.formData();
  const org = getOrgFromContext(context);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, ["admin", "errors"]);

  const action = String(formData.get("action") ?? "");

  // Ported verbatim from the previous users.tsx — magic-link invite
  // flow. We also accept an optional householdId to pre-link the
  // invitee.
  if (action === "createUser") {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = String(formData.get("role") ?? "");
    const linkHouseholdId = String(formData.get("linkHouseholdId") ?? "").trim();

    const result = await inviteUser(context, {
      request,
      email,
      name,
      role,
      scope: { kind: "org", id: org.id },
      invitedByUserId: actor.actorUserId ?? me.id,
      invitedByOnBehalfOfUserId: actor.onBehalfOfUserId,
      invitedByEmail: (me as { email?: string }).email ?? null,
      invitedToLabel: org.name,
    });
    if (!result.ok) {
      return dataWithError(null, inviteErrorMessage(result.error, t));
    }

    // Best-effort household link. We don't fail the invite if the link
    // step errors — the user is already created. We only set the
    // primaryContactName for the household so the existing fuzzy match
    // in user-details.server.ts picks it up later.
    if (linkHouseholdId) {
      try {
        const household = await prisma.household.findFirst({
          where: { id: linkHouseholdId, orgId: org.id },
          select: { id: true, primaryContactName: true },
        });
        if (household && !household.primaryContactName) {
          await prisma.household.update({
            where: { id: household.id },
            data: { primaryContactName: name },
          });
        }
      } catch (err) {
        console.error("invite household-link best-effort failed", err);
      }
    }

    return dataWithSuccess(null, t("admin:users.toasts.userInvited", { email }));
  }

  if (action === "impersonateUser") {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      return dataWithError(null, t("admin:users.errors.missingId"));
    }
    try {
      await requireTargetInOrg(prisma, userId, org.id);
    } catch (err) {
      if (err instanceof Response) {
        return dataWithError(null, t("admin:users.errors.userNotFound"));
      }
      throw err;
    }

    const session = await auth.api.getSession({ headers: request.headers });
    const impersonatedBy =
      (session?.session as { impersonatedBy?: string | null } | undefined)
        ?.impersonatedBy ?? null;
    if (assertNotAlreadyImpersonating(impersonatedBy)) {
      return dataWithError(null, t("admin:users.table.impersonateNestedError"));
    }

    const response = await auth.api.impersonateUser({
      body: { userId },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) {
      return dataWithError(null, t("admin:users.table.impersonateGenericError"));
    }

    const redirectHeaders = new Headers();
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      redirectHeaders.append("Set-Cookie", cookie);
    }
    redirectHeaders.set("Location", "/");
    return new Response(null, { status: 303, headers: redirectHeaders });
  }

  // Drawer-side fetcher: load the per-user details panel without a
  // full page refresh. Returns the JSON the drawer renders.
  if (action === "loadUserDetails") {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      return dataWithError(null, t("admin:users.errors.missingId"));
    }
    try {
      await requireTargetInOrg(prisma, userId, org.id);
    } catch (err) {
      if (err instanceof Response) {
        return dataWithError(null, t("admin:users.errors.userNotFound"));
      }
      throw err;
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) {
      return dataWithError(null, t("admin:users.errors.userNotFound"));
    }
    const session = await auth.api.getSession({ headers: request.headers });
    const currentSessionId = session?.session?.id ?? null;
    const [households, sessions, recentActivity, pendingInvite] = await Promise.all([
      findLinkedHouseholdsForUser(prisma, {
        orgId: org.id,
        userEmail: target.email,
        userName: target.name,
      }),
      loadUserSessions(prisma, { userId, currentSessionId }),
      loadRecentActivity(prisma, { userId, orgId: org.id }),
      findPendingInviteByUser(prisma, userId),
    ]);
    return {
      details: {
        userId,
        households,
        sessions,
        recentActivity,
        pendingInvite,
      },
    };
  }

  let outcome: AdminUsersActionOutcome;
  try {
    outcome = await handleAdminUsersAction({
      formData,
      requestHeaders: request.headers,
      requestUrl: request.url,
      actor: me,
      org,
      prisma,
      auth,
      hashPassword,
      viewerAccess: {
        setPin: (pin) => setViewerPin(context, pin),
        revokeAllSessions: () => revokeAllViewerSessions(context),
        resetLock: (clientKey) => resetViewerLock(context, clientKey),
        createMagicLink: (createdByUserId, daysValid) =>
          createViewerMagicLink(context, createdByUserId, daysValid),
      },
    });
  } catch (err) {
    if (err instanceof Response && err.status === 404) {
      return dataWithError(null, t("admin:users.errors.userNotFound"));
    }
    throw err;
  }
  return dataWithToast(outcome, t);
}

function inviteErrorMessage(error: InviteUserError, t: TFunction): string {
  if (error === "user-exists") return t("admin:users.errors.emailExists");
  if (error === "create-failed") return t("admin:users.errors.createUserFailed");
  if (error === "invalid-email") return "Enter a valid email address.";
  if (error === "invalid-name") return "Name is required.";
  return t("admin:users.errors.createUserFailed");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LoaderData = Route.ComponentProps["loaderData"];
type UserRow = LoaderData["users"][number];

function classifyStatus(user: UserRow): { tone: PillTone; label: string; symbol: string } {
  if (user.banned) return { tone: "danger", label: "Banned", symbol: "⊘" };
  if (user.pending) return { tone: "warning", label: "Pending", symbol: "⏳" };
  if (!user.lastActiveAt) return { tone: "neutral", label: "Idle", symbol: "○" };
  const ageMs = Date.now() - new Date(user.lastActiveAt).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs < dayMs) return { tone: "success", label: "Active", symbol: "●" };
  return { tone: "neutral", label: "Idle", symbol: "○" };
}

function roleTone(role: string | null | undefined): PillTone {
  if (role === "ADMIN") return "purple";
  if (role === "CONTROLLER") return "warning";
  return "neutral";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "Just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function shortDeviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return "Browser";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, locks, currentUserId, passwordResetEnabled, households } = loaderData;
  const { t } = useTranslation("admin");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const q = (searchParams.get("q") ?? "").trim();
  const roleFilter = (searchParams.get("role") ?? "ALL") as RoleFilter;
  const sort = (searchParams.get("sort") ?? "lastActive") as SortKey;

  const filtered = useMemo(() => {
    const lc = q.toLowerCase();
    const list = users.filter((u) => {
      if (lc) {
        const hay = `${u.name} ${u.email}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      if (roleFilter === "PENDING") return u.pending;
      if (roleFilter === "ALL") return true;
      return u.role === roleFilter;
    });
    list.sort((a, b) => {
      if (sort === "name") return (a.name ?? "").localeCompare(b.name ?? "");
      if (sort === "role") return (a.role ?? "").localeCompare(b.role ?? "");
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      // lastActive — pending and never-active sink to bottom
      const aAt = a.lastActiveAt ?? "";
      const bAt = b.lastActiveAt ?? "";
      if (!aAt && !bAt) return (a.name ?? "").localeCompare(b.name ?? "");
      if (!aAt) return 1;
      if (!bAt) return -1;
      return bAt.localeCompare(aAt);
    });
    return list;
  }, [users, q, roleFilter, sort]);

  const stats = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let activeToday = 0;
    let pending = 0;
    let banned = 0;
    for (const u of users) {
      if (u.banned) banned += 1;
      if (u.pending) pending += 1;
      if (u.lastActiveAt && now - new Date(u.lastActiveAt).getTime() < dayMs) {
        activeToday += 1;
      }
    }
    return { total: users.length, activeToday, pending, banned };
  }, [users]);

  const counts = useMemo(() => {
    const lc = q.toLowerCase();
    const matchesQuery = (u: UserRow) =>
      !lc || `${u.name} ${u.email}`.toLowerCase().includes(lc);
    return {
      ALL: users.filter(matchesQuery).length,
      ADMIN: users.filter((u) => matchesQuery(u) && u.role === "ADMIN").length,
      CONTROLLER: users.filter((u) => matchesQuery(u) && u.role === "CONTROLLER").length,
      VIEWER: users.filter((u) => matchesQuery(u) && u.role === "VIEWER").length,
      PENDING: users.filter((u) => matchesQuery(u) && u.pending).length,
    } satisfies Record<RoleFilter, number>;
  }, [users, q]);

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "ALL" || (key === "sort" && value === "lastActive")) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const selectedUser = filtered.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        passwordResetEnabled={passwordResetEnabled}
        onInvite={() => setInviteOpen(true)}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={stats.total} caption="Across this school" />
        <StatCard
          label="Active today"
          value={stats.activeToday}
          caption="Sessions in last 24h"
          tone="success"
        />
        <StatCard
          label="Pending invites"
          value={stats.pending}
          caption="Awaiting acceptance"
          tone="warning"
        />
        <StatCard
          label="Banned"
          value={stats.banned}
          caption="Cannot sign in"
          tone="danger"
        />
      </section>

      <FilterRow
        q={q}
        roleFilter={roleFilter}
        sort={sort}
        counts={counts}
        onChange={updateParam}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <UsersTable
          users={filtered}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((curr) => (curr === id ? null : id))}
          currentUserId={currentUserId}
        />
        <div className="min-h-[420px]">
          {selectedUser ? (
            <UserDetailDrawer
              key={selectedUser.id}
              user={selectedUser}
              currentUserId={currentUserId}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <EmptyDrawer />
          )}
        </div>
      </section>

      {inviteOpen ? (
        <InviteDrawer
          households={households}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      <ViewerAccessSection
        locks={locks}
        passwordResetEnabled={passwordResetEnabled}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + Filters
// ---------------------------------------------------------------------------

function PageHeader({
  passwordResetEnabled,
  onInvite,
}: {
  passwordResetEnabled: boolean;
  onInvite: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.9px] text-white/45">
          Access
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Users &amp; permissions</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/55">
          Invite staff, manage roles, and review who has signed in recently.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={passwordResetEnabled ? "success" : "neutral"}>
          <Mail className="h-3 w-3" />
          {passwordResetEnabled ? "Password reset: on" : "Password reset: off"}
        </StatusPill>
        <Button variant="primary" onPress={onInvite} className="gap-1">
          <Plus className="h-4 w-4" />
          Invite user
        </Button>
      </div>
    </div>
  );
}

function FilterRow({
  q,
  roleFilter,
  sort,
  counts,
  onChange,
}: {
  q: string;
  roleFilter: RoleFilter;
  sort: SortKey;
  counts: Record<RoleFilter, number>;
  onChange: (key: string, value: string | null) => void;
}) {
  // Local search input so typing isn't a re-render storm; commit on
  // submit / blur / 250ms idle.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 lg:flex-row lg:items-center lg:justify-between">
      <Form
        method="get"
        className="relative flex-1 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          onChange("q", draft.trim() || null);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="search"
          name="q"
          value={draft}
          onChange={(e) => {
            const value = e.target.value;
            setDraft(value);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              onChange("q", value.trim() || null);
            }, 250);
          }}
          placeholder="Search by name or email…"
          className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder-white/35 focus:border-blue-400 focus:outline-none"
        />
      </Form>
      <div className="flex flex-wrap items-center gap-1">
        {ROLE_FILTER_OPTIONS.map((opt) => {
          const active = roleFilter === opt;
          const label =
            opt === "ALL" ? "All" : opt.slice(0, 1) + opt.slice(1).toLowerCase();
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange("role", opt === "ALL" ? null : opt)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border border-blue-400/40 bg-blue-500/15 text-blue-200"
                  : "border border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
              }`}
            >
              {label}
              <span className="ml-1.5 text-white/40">{counts[opt]}</span>
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-white/55">
        <span>Sort</span>
        <select
          value={sort}
          onChange={(e) => onChange("sort", e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white focus:border-blue-400 focus:outline-none"
        >
          <option value="lastActive">Last active</option>
          <option value="name">Name</option>
          <option value="role">Role</option>
          <option value="created">Created</option>
        </select>
      </label>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const GRID_COLS =
  "grid-cols-[28px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_60px]";

function UsersTable({
  users,
  selectedId,
  onSelect,
  currentUserId,
}: {
  users: UserRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  currentUserId: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04]">
      <div
        className={`grid ${GRID_COLS} items-center gap-3 border-b border-white/[0.08] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.9px] text-white/40`}
      >
        <span aria-hidden="true" />
        <span>User</span>
        <span>Role</span>
        <span>Status</span>
        <span>Last active</span>
        <span className="text-right">Actions</span>
      </div>
      {users.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-white/45">
          No users match your filters.
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              selected={selectedId === user.id}
              onSelect={() => onSelect(user.id)}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UserRow({
  user,
  selected,
  onSelect,
  currentUserId,
}: {
  user: UserRow;
  selected: boolean;
  onSelect: () => void;
  currentUserId: string;
}) {
  const status = classifyStatus(user);
  const isMe = user.id === currentUserId;
  const isPending = user.pending;
  const lastActiveLabel = isPending ? "—" : relativeTime(user.lastActiveAt);
  const subLine = isPending
    ? null
    : user.sessionCount > 0
    ? `${user.sessionCount} session${user.sessionCount === 1 ? "" : "s"}`
    : "No sessions";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full ${GRID_COLS} items-center gap-3 px-3 py-3 text-left transition-colors ${
        selected
          ? "bg-blue-500/10 ring-1 ring-inset ring-blue-400/30"
          : "hover:bg-white/[0.03]"
      }`}
    >
      <span className="flex justify-center">
        <input
          type="checkbox"
          aria-label={`Select ${user.name || user.email}`}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <EntityAvatar
          initials={deriveInitials(user.name || user.email, "?")}
          colorSeed={user.id}
          pending={isPending}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">
              {isPending && !user.name ? user.email : user.name || user.email}
            </span>
            {isMe ? (
              <span className="text-[10px] uppercase tracking-wider text-white/35">
                You
              </span>
            ) : null}
          </span>
          {!isPending ? (
            <span className="block truncate text-xs text-white/45">{user.email}</span>
          ) : (
            <span className="block truncate text-xs text-amber-300/70">
              Invitation pending
            </span>
          )}
        </span>
      </span>
      <span>
        <StatusPill tone={roleTone(user.role)}>
          {user.role ?? "VIEWER"}
        </StatusPill>
      </span>
      <span>
        <StatusPill tone={status.tone}>
          <span aria-hidden="true">{status.symbol}</span>
          {status.label}
        </StatusPill>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-white/80">{lastActiveLabel}</span>
        {isPending ? (
          <ResendInviteLink user={user} />
        ) : (
          <span className="block truncate text-xs text-white/40">{subLine}</span>
        )}
      </span>
      <span className="flex justify-end">
        <span
          className="rounded-md p-1 text-white/40 hover:text-white"
          aria-hidden="true"
        >
          <MoreHorizontal className="h-4 w-4" />
        </span>
      </span>
    </button>
  );
}

function ResendInviteLink({ user }: { user: UserRow }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="action" value="createUser" />
      <input type="hidden" name="email" value={user.email} />
      <input type="hidden" name="name" value={user.name} />
      <input type="hidden" name="role" value={user.role ?? "VIEWER"} />
      <button
        type="submit"
        onClick={(e) => e.stopPropagation()}
        disabled={fetcher.state !== "idle"}
        className="text-xs text-blue-300 hover:underline disabled:opacity-50"
      >
        {fetcher.state === "idle" ? "Resend" : "Sending…"}
      </button>
    </fetcher.Form>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

function EmptyDrawer() {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
      <UserPlus className="h-6 w-6 text-white/30" />
      <p className="text-sm text-white/55">Select a user to manage their access.</p>
      <p className="text-xs text-white/35">
        You'll see linked households, sessions, and recent activity here.
      </p>
    </div>
  );
}

type DrawerDetails = {
  userId: string;
  households: UserHouseholdLink[];
  sessions: UserSessionInfo[];
  recentActivity: UserActivityEntry[];
  pendingInvite: { id: string; createdAt: string; expiresAt: string } | null;
};

function UserDetailDrawer({
  user,
  currentUserId,
  onClose,
}: {
  user: UserRow;
  currentUserId: string;
  onClose: () => void;
}) {
  const detailsFetcher = useFetcher<{ details?: DrawerDetails }>();
  const actionFetcher = useFetcher();
  const [banOpen, setBanOpen] = useState(false);

  // Load on mount + when the user changes.
  useEffect(() => {
    const fd = new FormData();
    fd.set("action", "loadUserDetails");
    fd.set("userId", user.id);
    detailsFetcher.submit(fd, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const details = detailsFetcher.data?.details;
  const isMe = user.id === currentUserId;

  return (
    <aside className="flex h-full flex-col gap-4 rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <header className="flex items-start gap-3">
        <EntityAvatar
          initials={deriveInitials(user.name || user.email, "?")}
          colorSeed={user.id}
          size="lg"
          pending={user.pending}
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-white">
            {user.name || user.email}
          </p>
          <p className="truncate text-xs text-white/55">{user.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill tone={roleTone(user.role)}>{user.role ?? "VIEWER"}</StatusPill>
            <StatusPill tone={classifyStatus(user).tone}>
              {classifyStatus(user).label}
            </StatusPill>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {!isMe ? (
        <RoleTileSelector userId={user.id} role={(user.role ?? "VIEWER") as Role} />
      ) : (
        <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/55">
          You can't change your own role from this panel.
        </p>
      )}

      <section className="space-y-2">
        <SectionHeader
          title="Linked households"
          count={details?.households.length ?? 0}
        />
        {!details ? (
          <SkeletonRow />
        ) : details.households.length === 0 ? (
          <p className="rounded-lg bg-white/[0.03] p-3 text-xs text-white/45">
            No households are tagged with this user yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {details.households.map((h) => (
              <li
                key={h.id}
                className="rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <EntityLink to="/admin/households" arrow>
                    {h.name}
                  </EntityLink>
                  <span className="text-[11px] text-white/40">
                    {h.studentNames.length} student
                    {h.studentNames.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-white/55">
                  {h.studentNames.length > 0
                    ? h.studentNames.join(", ")
                    : "No students assigned"}
                  {h.classroomList.length > 0
                    ? ` · ${h.classroomList.join(", ")}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="Active sessions"
          count={details?.sessions.length ?? 0}
          actions={
            !isMe && details && details.sessions.length > 0 ? (
              <actionFetcher.Form method="post">
                <input type="hidden" name="action" value="revokeUserSessions" />
                <input type="hidden" name="userId" value={user.id} />
                <button
                  type="submit"
                  disabled={actionFetcher.state !== "idle"}
                  className="text-xs text-rose-300 hover:underline disabled:opacity-50"
                >
                  Revoke all
                </button>
              </actionFetcher.Form>
            ) : null
          }
        />
        {!details ? (
          <SkeletonRow />
        ) : details.sessions.length === 0 ? (
          <p className="rounded-lg bg-white/[0.03] p-3 text-xs text-white/45">
            No active sessions.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {details.sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"
              >
                <span className="text-white/80">{shortDeviceLabel(s.userAgent)}</span>
                <span className="flex items-center gap-2 text-white/45">
                  {s.current ? (
                    <StatusPill tone="info">Current</StatusPill>
                  ) : null}
                  <span>{relativeTime(s.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader title="Recent activity" />
        {!details ? (
          <SkeletonRow />
        ) : details.recentActivity.length === 0 ? (
          <p className="rounded-lg bg-white/[0.03] p-3 text-xs text-white/45">
            No recent activity.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {details.recentActivity.map((a) => (
              <li
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs"
              >
                <span>
                  <span className="block text-white/80">{a.label}</span>
                  {a.detail ? (
                    <span className="block text-white/45">{a.detail}</span>
                  ) : null}
                </span>
                <span className="whitespace-nowrap text-white/40">
                  {relativeTime(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-auto flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {!isMe ? (
          <actionFetcher.Form method="post">
            <input type="hidden" name="action" value="resetPassword" />
            <input type="hidden" name="userId" value={user.id} />
            <Button
              size="sm"
              variant="ghost"
              type="submit"
              isDisabled={actionFetcher.state !== "idle"}
            >
              <RotateCcw className="h-3 w-3" />
              Reset password
            </Button>
          </actionFetcher.Form>
        ) : null}
        {!isMe ? <ImpersonateButton user={user} /> : null}
        {!isMe ? (
          user.banned ? (
            <actionFetcher.Form method="post">
              <input type="hidden" name="action" value="unban" />
              <input type="hidden" name="userId" value={user.id} />
              <Button
                size="sm"
                variant="ghost"
                type="submit"
                isDisabled={actionFetcher.state !== "idle"}
              >
                <UserCheck className="h-3 w-3" />
                Unban
              </Button>
            </actionFetcher.Form>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setBanOpen(true)}
              className="text-rose-300"
            >
              <Ban className="h-3 w-3" />
              Ban
            </Button>
          )
        ) : null}
        {!isMe ? (
          <actionFetcher.Form method="post" className="ml-auto">
            <input type="hidden" name="action" value="deleteUser" />
            <input type="hidden" name="userId" value={user.id} />
            <Button
              size="sm"
              variant="danger"
              type="submit"
              isDisabled={actionFetcher.state !== "idle"}
              onPress={(e: any) => {
                if (
                  !confirm(
                    `Delete ${user.name || user.email}? This cannot be undone.`,
                  )
                ) {
                  e?.preventDefault?.();
                }
              }}
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </actionFetcher.Form>
        ) : null}
      </section>

      {banOpen ? (
        <BanModal
          user={user}
          onClose={() => setBanOpen(false)}
        />
      ) : null}
    </aside>
  );
}

function SkeletonRow() {
  return (
    <div className="h-12 animate-pulse rounded-lg bg-white/[0.03]" aria-hidden="true" />
  );
}

function RoleTileSelector({ userId, role }: { userId: string; role: Role }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="grid grid-cols-3 gap-2">
      <input type="hidden" name="action" value="changeRole" />
      <input type="hidden" name="userId" value={userId} />
      {ROLE_OPTIONS.map((opt) => {
        const active = role === opt;
        return (
          <button
            key={opt}
            type="submit"
            name="role"
            value={opt}
            disabled={fetcher.state !== "idle"}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              active
                ? opt === "ADMIN"
                  ? "border-violet-400/40 bg-violet-500/15 text-violet-100"
                  : opt === "CONTROLLER"
                  ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                  : "border-white/30 bg-white/[0.08] text-white"
                : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
            }`}
          >
            <span className="block text-sm font-semibold">
              {opt === "ADMIN"
                ? "Admin"
                : opt === "CONTROLLER"
                ? "Controller"
                : "Viewer"}
            </span>
            <span className="mt-0.5 block text-[10px] uppercase tracking-wider opacity-60">
              {opt === "ADMIN"
                ? "Full access"
                : opt === "CONTROLLER"
                ? "Pickup ops"
                : "Read-only"}
            </span>
          </button>
        );
      })}
    </fetcher.Form>
  );
}

function ImpersonateButton({ user }: { user: UserRow }) {
  const fetcher = useFetcher();
  const isLoading = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="action" value="impersonateUser" />
      <input type="hidden" name="userId" value={user.id} />
      <Button
        size="sm"
        variant="ghost"
        type="submit"
        isDisabled={isLoading}
      >
        <LogIn className="h-3 w-3" />
        {isLoading ? "Impersonating…" : "Impersonate"}
      </Button>
    </fetcher.Form>
  );
}

function BanModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");
  const fetcher = useFetcher();
  const [reason, setReason] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-xl border border-white/10 bg-[#1a1f1f] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold text-white">
          {t("users.ban.heading", { name: user.name || user.email })}
        </h3>
        <p className="mb-4 text-sm text-white/50">{t("users.ban.body")}</p>
        <label className="mb-1 block text-sm text-white/60">
          {t("users.ban.reasonLabel")}
        </label>
        <input
          className="app-field mb-4 w-full focus:border-blue-500"
          placeholder={t("users.ban.reasonPlaceholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onPress={onClose}>
            {tCommon("buttons.cancel")}
          </Button>
          <fetcher.Form method="post" onSubmit={onClose}>
            <input type="hidden" name="action" value="ban" />
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="banReason" value={reason} />
            <Button
              size="sm"
              variant="danger"
              type="submit"
              isDisabled={!reason || fetcher.state !== "idle"}
            >
              {t("users.ban.submit")}
            </Button>
          </fetcher.Form>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite drawer (modal)
// ---------------------------------------------------------------------------

function InviteDrawer({
  households,
  onClose,
}: {
  households: { id: string; name: string }[];
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CONTROLLER");
  const [linkHouseholdId, setLinkHouseholdId] = useState("");

  // Auto-close once the invite returns successfully (no error in payload).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as any)?.error == null) {
      // Best-effort: only close if we just submitted at least once. The
      // useFetcher data is undefined until a submission completes.
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#1a1f1f] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.9px] text-white/45">
              Invite
            </p>
            <h2 className="text-xl font-semibold text-white">Invite a user</h2>
            <p className="mt-1 text-sm text-white/55">
              We'll email a magic-link invite. They set their own password on accept.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <fetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="action" value="createUser" />
          <label className="flex flex-col gap-1 text-xs text-white/60">
            <span>Full name</span>
            <Input
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            <span>Email</span>
            <Input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-white/60">Role</legend>
            <div className="grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const active = role === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setRole(opt)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? opt === "ADMIN"
                          ? "border-violet-400/40 bg-violet-500/15 text-violet-100"
                          : opt === "CONTROLLER"
                          ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                          : "border-white/30 bg-white/[0.08] text-white"
                        : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white"
                    }`}
                  >
                    {opt === "ADMIN"
                      ? "Admin"
                      : opt === "CONTROLLER"
                      ? "Controller"
                      : "Viewer"}
                  </button>
                );
              })}
            </div>
            <input type="hidden" name="role" value={role} />
          </fieldset>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            <span>Link to household (optional)</span>
            <select
              name="linkHouseholdId"
              value={linkHouseholdId}
              onChange={(e) => setLinkHouseholdId(e.target.value)}
              className="app-field"
            >
              <option value="">No household link</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-white/40">
              Pre-associates this user with the household for the connection panel.
            </span>
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" type="button" onPress={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isDisabled={fetcher.state !== "idle" || !name.trim() || !email.trim()}
            >
              <Mail className="h-3 w-3" />
              Send invite
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer access section (PIN, magic link, lockouts) — ported with new chrome
// ---------------------------------------------------------------------------

function ViewerAccessSection({
  locks,
  passwordResetEnabled,
}: {
  locks: LoaderData["locks"];
  passwordResetEnabled: boolean;
}) {
  const { t, i18n } = useTranslation("admin");
  const fetcher = useFetcher<AdminUsersFetcherData>();
  const [viewerPin, setViewerPinState] = useState("");
  const [daysValid, setDaysValid] = useState("7");
  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <header className="mb-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.9px] text-white/45">
          Viewer privacy
        </p>
        <h2 className="mt-1 text-base font-semibold text-white">
          {t("users.viewer.heading")}
        </h2>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-white/70">
            {t("users.viewer.resetPin")}
          </h3>
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="action" value="setViewerPin" />
            <Input
              name="pin"
              required
              minLength={4}
              maxLength={32}
              placeholder={t("users.viewer.pinPlaceholder")}
              value={viewerPin}
              onChange={(e) => setViewerPinState(e.target.value)}
            />
            <label className="inline-flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" name="revokeViewerSessions" value="on" />
              {t("users.viewer.revokeSessions")}
            </label>
            <Button
              type="submit"
              variant="primary"
              isDisabled={
                fetcher.state !== "idle" || viewerPin.trim().length < 4
              }
            >
              <KeyRound className="h-4 w-4" />
              {t("users.viewer.savePin")}
            </Button>
          </fetcher.Form>
          {fetcher.data?.viewerPin ? (
            <p className="text-xs text-yellow-300">
              New PIN: {fetcher.data.viewerPin}
            </p>
          ) : null}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-white/70">
            {t("users.viewer.createMagicLink")}
          </h3>
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="action" value="createViewerMagicLink" />
            <Input
              type="number"
              name="daysValid"
              min={1}
              max={30}
              value={daysValid}
              onChange={(e) => setDaysValid(e.target.value)}
              placeholder={t("users.viewer.daysValidPlaceholder")}
            />
            <p className="text-xs text-white/60">
              {t("users.viewer.linkValid", { days: daysValid || "7" })}
            </p>
            <Button
              type="submit"
              variant="primary"
              isDisabled={fetcher.state !== "idle"}
            >
              <LinkIcon className="h-4 w-4" />
              {t("users.viewer.generateLink")}
            </Button>
          </fetcher.Form>
          {fetcher.data?.magicLink ? (
            <p className="break-all text-xs text-green-300">
              {fetcher.data.magicLink}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-medium text-white/70">
          {t("users.viewer.lockedClients")}
        </h3>
        {locks.length === 0 ? (
          <p className="text-sm text-white/50">{t("users.viewer.noLockouts")}</p>
        ) : (
          <div className="space-y-2">
            {locks.map((lock) => (
              <div
                key={lock.clientKey}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2"
              >
                <div className="text-sm text-white/80">
                  {lock.ipHint ?? t("users.viewer.unknownNetwork")} -{" "}
                  {lock.requiresAdminReset
                    ? t("users.viewer.adminResetRequired")
                    : t("users.viewer.lockedUntil", {
                        when: lock.lockedUntil
                          ? new Date(lock.lockedUntil).toLocaleString(
                              i18n.language,
                            )
                          : t("users.viewer.lockedUntilUnknown"),
                      })}
                </div>
                <fetcher.Form method="post">
                  <input type="hidden" name="action" value="resetViewerLock" />
                  <input type="hidden" name="clientKey" value={lock.clientKey} />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="submit"
                    isDisabled={fetcher.state !== "idle"}
                  >
                    <ShieldX className="h-3 w-3" />
                    {t("users.viewer.resetLock")}
                  </Button>
                </fetcher.Form>
              </div>
            ))}
          </div>
        )}
      </div>
      <fetcher.Form
        method="post"
        className="mt-6 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-sm"
      >
        <input type="hidden" name="action" value="setPasswordResetEnabled" />
        <label className="inline-flex items-center gap-2 text-white/85">
          <input
            type="checkbox"
            name="enabled"
            value="on"
            defaultChecked={passwordResetEnabled}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
          {t("users.passwordReset.label")}
        </label>
        <span className="text-xs text-white/45">
          {t("users.passwordReset.ssoHint")}
        </span>
      </fetcher.Form>
    </section>
  );
}
