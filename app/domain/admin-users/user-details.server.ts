import type { PrismaClient } from "~/db";

/**
 * Minimal Prisma surface we use here. Letting the route pass either
 * `getPrisma(context)` (global) or `getTenantPrisma(context)` (scoped)
 * means tests can supply a fake without depending on the full client.
 */
type DetailsPrisma = Pick<
  PrismaClient,
  "user" | "session" | "household" | "userInviteToken" | "callEvent" | "student"
>;

export type UserHouseholdLink = {
  id: string;
  name: string;
  studentNames: string[];
  classroomList: string[];
};

export type UserSessionInfo = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type UserActivityEntry = {
  id: string;
  kind: "pickup-release" | "invite-issued";
  label: string;
  detail: string | null;
  at: string;
};

export type UserDetailsBundle = {
  households: UserHouseholdLink[];
  sessions: UserSessionInfo[];
  recentActivity: UserActivityEntry[];
  pendingInvite: { id: string; createdAt: string; expiresAt: string } | null;
  /** ISO of most recent session activity (createdAt) or null if never. */
  lastActiveAt: string | null;
};

/**
 * Look up Households whose member students share the given user's email.
 * Households don't carry an explicit "members" link — we treat the
 * `primaryContactName` and student-email matching as the connection.
 * Right now we only have `primaryContactName`, no email; in the absence
 * of a column match we look for households where the user's name appears
 * in `primaryContactName`. This is the connection-density move described
 * in the redesign brief; production schools can later upgrade to an
 * explicit join table.
 */
export async function findLinkedHouseholdsForUser(
  prisma: DetailsPrisma,
  args: { orgId: string; userEmail: string; userName: string },
): Promise<UserHouseholdLink[]> {
  const { orgId, userName, userEmail } = args;

  // Try matching on primaryContactName first (case-insensitive). Email is
  // not stored on Household today, so the fallback is the contact name.
  // We OR with the local-part of the email as a softer match.
  const emailLocal = userEmail.split("@")[0]?.trim() ?? "";
  const candidates = await prisma.household.findMany({
    where: {
      orgId,
      OR: [
        userName ? { primaryContactName: { contains: userName } } : { id: "__never__" },
        emailLocal ? { primaryContactName: { contains: emailLocal } } : { id: "__never__" },
      ],
    },
    orderBy: { name: "asc" },
    take: 20,
  });
  if (candidates.length === 0) return [];

  const householdIds = candidates.map((h) => h.id);
  const students = await prisma.student.findMany({
    where: { householdId: { in: householdIds } },
    select: {
      firstName: true,
      lastName: true,
      homeRoom: true,
      householdId: true,
    },
  });
  const byHousehold = new Map<string, typeof students>();
  for (const s of students) {
    if (!s.householdId) continue;
    const list = byHousehold.get(s.householdId) ?? [];
    list.push(s);
    byHousehold.set(s.householdId, list);
  }
  return candidates.map((h) => {
    const list = byHousehold.get(h.id) ?? [];
    return {
      id: h.id,
      name: h.name,
      studentNames: list.map((s) => `${s.firstName} ${s.lastName}`.trim()),
      classroomList: Array.from(
        new Set(
          list
            .map((s) => s.homeRoom)
            .filter((r): r is string => typeof r === "string" && r.length > 0),
        ),
      ),
    };
  });
}

/**
 * Active better-auth sessions for the user, newest first.
 * `currentSessionId` is the request's own session — when it matches we
 * mark `current: true` so the UI can label that row.
 */
export async function loadUserSessions(
  prisma: DetailsPrisma,
  args: { userId: string; currentSessionId?: string | null },
): Promise<UserSessionInfo[]> {
  const sessions = await prisma.session.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return sessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent ?? null,
    ipAddress: s.ipAddress ?? null,
    createdAt:
      s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    expiresAt:
      s.expiresAt instanceof Date ? s.expiresAt.toISOString() : String(s.expiresAt),
    current: s.id === args.currentSessionId,
  }));
}

/**
 * Recent activity for a user: last 5 dismissal releases they triggered
 * (CallEvent rows attributed to them). UserInviteToken creation by
 * this user is also surfaced.
 */
export async function loadRecentActivity(
  prisma: DetailsPrisma,
  args: { userId: string; orgId: string },
): Promise<UserActivityEntry[]> {
  const [calls, invites] = await Promise.all([
    prisma.callEvent.findMany({
      where: { actorUserId: args.userId, orgId: args.orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.userInviteToken.findMany({
      where: { invitedByUserId: args.userId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const callEntries: UserActivityEntry[] = calls.map((c) => ({
    id: `call:${c.id}`,
    kind: "pickup-release",
    label: `Released ${c.studentName}`,
    detail: c.homeRoomSnapshot ? `Homeroom ${c.homeRoomSnapshot}` : null,
    at: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  }));
  const inviteEntries: UserActivityEntry[] = invites.map((i) => ({
    id: `invite:${i.id}`,
    kind: "invite-issued",
    label: "Issued invite",
    detail: i.usedAt ? "Accepted" : i.revokedAt ? "Revoked" : "Pending",
    at: i.createdAt instanceof Date ? i.createdAt.toISOString() : String(i.createdAt),
  }));
  return [...callEntries, ...inviteEntries]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 5);
}

/**
 * Most recent session createdAt timestamp for each userId. Used to
 * power "Last active" / "Active today" on the index. Single grouped
 * query so we don't fan out per-user.
 */
export async function loadLastActiveByUser(
  prisma: DetailsPrisma,
  userIds: string[],
): Promise<Map<string, { lastActiveAt: string; sessionCount: number }>> {
  if (userIds.length === 0) return new Map();
  const sessions = await prisma.session.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, createdAt: true },
  });
  const map = new Map<string, { lastActiveAt: string; sessionCount: number }>();
  for (const s of sessions) {
    const at =
      s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt);
    const existing = map.get(s.userId);
    if (!existing) {
      map.set(s.userId, { lastActiveAt: at, sessionCount: 1 });
    } else {
      existing.sessionCount += 1;
      if (at > existing.lastActiveAt) existing.lastActiveAt = at;
    }
  }
  return map;
}

/**
 * Look up the open invite (if any) for a given userId. The invite-user
 * flow creates a User row immediately and a UserInviteToken; until the
 * token is consumed (`usedAt` set), the user has not actually logged in.
 */
export async function findPendingInviteByUser(
  prisma: DetailsPrisma,
  userId: string,
): Promise<{ id: string; createdAt: string; expiresAt: string } | null> {
  const invite = await prisma.userInviteToken.findFirst({
    where: { userId, usedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!invite) return null;
  return {
    id: invite.id,
    createdAt:
      invite.createdAt instanceof Date
        ? invite.createdAt.toISOString()
        : String(invite.createdAt),
    expiresAt:
      invite.expiresAt instanceof Date
        ? invite.expiresAt.toISOString()
        : String(invite.expiresAt),
  };
}

/**
 * Returns the set of userIds with a still-pending invite (one query for
 * the index page so we can mark each row as "Pending").
 */
export async function loadPendingInviteIdsForOrg(
  prisma: DetailsPrisma,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const invites = await prisma.userInviteToken.findMany({
    where: { userId: { in: userIds }, usedAt: null, revokedAt: null },
    select: { userId: true },
  });
  return new Set(invites.map((i) => i.userId));
}
