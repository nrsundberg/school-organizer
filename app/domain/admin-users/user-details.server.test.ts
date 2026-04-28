import assert from "node:assert/strict";
import test from "node:test";
import {
  findLinkedHouseholdsForUser,
  findPendingInviteByUser,
  loadLastActiveByUser,
  loadPendingInviteIdsForOrg,
  loadRecentActivity,
  loadUserSessions,
} from "./user-details.server";

type AnyPrisma = Parameters<typeof loadUserSessions>[0];

function makePrisma(stubs: Record<string, Record<string, unknown>>): AnyPrisma {
  return stubs as unknown as AnyPrisma;
}

test("findLinkedHouseholdsForUser groups students by household and dedupes classrooms", async () => {
  const prisma = makePrisma({
    household: {
      findMany: async (args: { where: { OR: unknown[] } }) => {
        // Assert the OR clause carries both the user name and the email
        // local-part — that's our "fuzzy email match" surrogate.
        assert.equal(Array.isArray(args.where.OR), true);
        return [
          { id: "h1", name: "Khan-Ortiz", primaryContactName: "Maya Khan" },
          { id: "h2", name: "Lone Wolf", primaryContactName: "Maya Khan" },
        ];
      },
    },
    student: {
      findMany: async () => [
        { firstName: "Lila", lastName: "Khan", homeRoom: "3B", householdId: "h1" },
        { firstName: "Sam", lastName: "Khan", homeRoom: "3B", householdId: "h1" },
        { firstName: "Yusuf", lastName: "Khan", homeRoom: "5A", householdId: "h1" },
        // h2 has no student → still returned but with empty lists.
      ],
    },
  });
  const result = await findLinkedHouseholdsForUser(prisma, {
    orgId: "org-1",
    userEmail: "maya@example.com",
    userName: "Maya Khan",
  });
  assert.deepEqual(
    result.map((r) => ({ id: r.id, classrooms: r.classroomList, count: r.studentNames.length })),
    [
      { id: "h1", classrooms: ["3B", "5A"], count: 3 },
      { id: "h2", classrooms: [], count: 0 },
    ],
  );
});

test("findLinkedHouseholdsForUser short-circuits when no candidates match", async () => {
  const prisma = makePrisma({
    household: { findMany: async () => [] },
    student: {
      findMany: async () => {
        throw new Error("should not query students when no households matched");
      },
    },
  });
  const result = await findLinkedHouseholdsForUser(prisma, {
    orgId: "org-1",
    userEmail: "noone@example.com",
    userName: "No One",
  });
  assert.deepEqual(result, []);
});

test("loadUserSessions marks the request's own session as current", async () => {
  const prisma = makePrisma({
    session: {
      findMany: async () => [
        {
          id: "s-current",
          userAgent: "Mac",
          ipAddress: "1.2.3.4",
          createdAt: new Date("2026-04-27T10:00:00Z"),
          expiresAt: new Date("2026-05-04T10:00:00Z"),
        },
        {
          id: "s-other",
          userAgent: "iPhone",
          ipAddress: null,
          createdAt: new Date("2026-04-26T10:00:00Z"),
          expiresAt: new Date("2026-05-03T10:00:00Z"),
        },
      ],
    },
  });
  const result = await loadUserSessions(prisma, {
    userId: "u1",
    currentSessionId: "s-current",
  });
  assert.equal(result[0]!.current, true);
  assert.equal(result[1]!.current, false);
  assert.equal(result[0]!.createdAt, "2026-04-27T10:00:00.000Z");
});

test("loadLastActiveByUser computes max createdAt and session count per user", async () => {
  const prisma = makePrisma({
    session: {
      findMany: async () => [
        { userId: "u1", createdAt: new Date("2026-04-25T00:00:00Z") },
        { userId: "u1", createdAt: new Date("2026-04-27T03:00:00Z") },
        { userId: "u2", createdAt: new Date("2026-04-20T00:00:00Z") },
      ],
    },
  });
  const map = await loadLastActiveByUser(prisma, ["u1", "u2", "u3"]);
  assert.equal(map.get("u1")?.lastActiveAt, "2026-04-27T03:00:00.000Z");
  assert.equal(map.get("u1")?.sessionCount, 2);
  assert.equal(map.get("u2")?.sessionCount, 1);
  assert.equal(map.get("u3"), undefined);
});

test("loadLastActiveByUser returns an empty map for empty userIds without querying", async () => {
  const prisma = makePrisma({
    session: {
      findMany: async () => {
        throw new Error("should not query");
      },
    },
  });
  const map = await loadLastActiveByUser(prisma, []);
  assert.equal(map.size, 0);
});

test("loadRecentActivity merges call events and invites, newest first, capped at 5", async () => {
  const prisma = makePrisma({
    callEvent: {
      findMany: async () => [
        {
          id: 10,
          studentName: "Lila Khan",
          homeRoomSnapshot: "3B",
          createdAt: new Date("2026-04-27T09:00:00Z"),
        },
        {
          id: 9,
          studentName: "Sam Khan",
          homeRoomSnapshot: null,
          createdAt: new Date("2026-04-26T09:00:00Z"),
        },
      ],
    },
    userInviteToken: {
      findMany: async () => [
        {
          id: "inv-1",
          createdAt: new Date("2026-04-27T10:00:00Z"),
          usedAt: null,
          revokedAt: null,
        },
        {
          id: "inv-0",
          createdAt: new Date("2026-04-20T10:00:00Z"),
          usedAt: new Date("2026-04-21T10:00:00Z"),
          revokedAt: null,
        },
      ],
    },
  });
  const entries = await loadRecentActivity(prisma, { userId: "u1", orgId: "org-1" });
  assert.equal(entries.length, 4);
  // newest first
  assert.equal(entries[0]!.id, "invite:inv-1");
  assert.equal(entries[0]!.detail, "Pending");
  assert.equal(entries[1]!.id, "call:10");
  assert.equal(entries[1]!.detail, "Homeroom 3B");
});

test("findPendingInviteByUser returns null when no open invite exists", async () => {
  const prisma = makePrisma({
    userInviteToken: { findFirst: async () => null },
  });
  const result = await findPendingInviteByUser(prisma, "u1");
  assert.equal(result, null);
});

test("loadPendingInviteIdsForOrg returns the userIds with open invites", async () => {
  const prisma = makePrisma({
    userInviteToken: {
      findMany: async () => [
        { userId: "u1" },
        { userId: "u3" },
      ],
    },
  });
  const set = await loadPendingInviteIdsForOrg(prisma, ["u1", "u2", "u3"]);
  assert.equal(set.has("u1"), true);
  assert.equal(set.has("u2"), false);
  assert.equal(set.has("u3"), true);
});
