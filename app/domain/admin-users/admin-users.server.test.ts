import assert from "node:assert/strict";
import test from "node:test";
import type { Org } from "~/db";
import {
  buildViewerMagicLink,
  generateTempPassword,
  handleAdminUsersAction,
  isDuplicateUserError,
  loadAdminUsersData,
  type AdminUserActor,
  type AdminUsersAuth,
  type AdminUsersPrisma,
  type AdminUsersTenantPrisma,
  type AdminUsersViewerAccess,
} from "./admin-users.server";

function formData(entries: Record<string, string | boolean>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "boolean") {
      if (value) form.set(key, "on");
    } else {
      form.set(key, value);
    }
  }
  return form;
}

function org(overrides: Partial<Org> = {}): Org {
  return {
    id: "org-1",
    passwordResetEnabled: true,
    ...overrides,
  } as Org;
}

function actor(role = "ADMIN"): AdminUserActor {
  return { id: "admin-1", role };
}

function viewerAccess(
  overrides: Partial<AdminUsersViewerAccess> = {},
): AdminUsersViewerAccess {
  return {
    setPin: async () => {},
    revokeAllSessions: async () => 0,
    resetLock: async () => {},
    createMagicLink: async () => "token",
    ...overrides,
  };
}

function auth(overrides: Partial<AdminUsersAuth["api"]> = {}): AdminUsersAuth {
  return {
    api: {
      banUser: async () => {},
      unbanUser: async () => {},
      ...overrides,
    },
  };
}

type PrismaFixtureOptions = {
  /** When false, prisma.user.findFirst (the tenant guard's lookup) returns null. */
  targetInOrg?: boolean;
};

function prismaFixture(options: PrismaFixtureOptions = {}) {
  const targetInOrg = options.targetInOrg ?? true;
  const userUpdates: unknown[] = [];
  const userDeletes: unknown[] = [];
  const userFindFirstArgs: unknown[] = [];
  const orgUpdates: unknown[] = [];
  const accountUpdates: unknown[] = [];
  const sessionDeletes: unknown[] = [];

  const prisma = {
    user: {
      findMany: async () => [],
      // findFirst is what `requireTargetInOrg` calls. By returning null for
      // out-of-org targets we can assert that mutations are refused when
      // the tenant guard fires.
      findFirst: async (args: unknown) => {
        userFindFirstArgs.push(args);
        return targetInOrg ? { id: "target-user" } : null;
      },
      update: async (args: unknown) => {
        userUpdates.push(args);
        return {};
      },
      delete: async (args: unknown) => {
        userDeletes.push(args);
        return {};
      },
    },
    account: {
      findFirst: async () => ({ id: "account-1" }),
      update: async (args: unknown) => {
        accountUpdates.push(args);
        return {};
      },
    },
    session: {
      deleteMany: async (args: unknown) => {
        sessionDeletes.push(args);
        return { count: 2 };
      },
    },
    org: {
      update: async (args: unknown) => {
        orgUpdates.push(args);
        return {};
      },
    },
  } as unknown as AdminUsersPrisma;

  return {
    prisma,
    calls: {
      userUpdates,
      userDeletes,
      userFindFirstArgs,
      orgUpdates,
      accountUpdates,
      sessionDeletes,
    },
  };
}

test("generateTempPassword maps random bytes to the allowed 12-character alphabet", () => {
  const password = generateTempPassword((array) => {
    array.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    return array;
  });

  assert.equal(password, "ABCDEFGHJKMN");
  assert.match(password, /^[A-HJ-NP-Za-hj-np-z2-9]{12}$/);
});

test("isDuplicateUserError recognizes Better Auth duplicate-account shapes", () => {
  assert.equal(isDuplicateUserError(new Error("user already exists")), true);
  assert.equal(isDuplicateUserError({ status: 422 }), true);
  assert.equal(isDuplicateUserError(new Error("network failed")), false);
});

test("buildViewerMagicLink uses the request origin and URL-encodes the token", () => {
  assert.equal(
    buildViewerMagicLink("https://school.example.org/admin/users", "a b+c"),
    "https://school.example.org/viewer-access?token=a%20b%2Bc",
  );
});

test("loadAdminUsersData returns users, active locks, current user, and org reset setting", async () => {
  const userFindCalls: unknown[] = [];
  const lockFindCalls: unknown[] = [];
  const users = [{ id: "u1", name: "Ada" }];
  const locks = [{ clientKey: "client-1" }];
  const prisma = {
    user: {
      findMany: async (args: unknown) => {
        userFindCalls.push(args);
        return users;
      },
    },
  } as unknown as AdminUsersPrisma;
  const tenantPrisma = {
    viewerAccessAttempt: {
      findMany: async (args: unknown) => {
        lockFindCalls.push(args);
        return locks;
      },
    },
  } as unknown as AdminUsersTenantPrisma;

  const result = await loadAdminUsersData({
    prisma,
    tenantPrisma,
    org: org({ id: "org-7", passwordResetEnabled: false }),
    currentUserId: "u1",
  });

  assert.equal(result.users, users);
  assert.equal(result.locks, locks);
  assert.equal(result.currentUserId, "u1");
  assert.equal(result.passwordResetEnabled, false);
  // The User table is excluded from TENANT_MODELS so the tenant Prisma
  // extension does NOT auto-scope this query — `loadAdminUsersData` must
  // pass an explicit { orgId } filter or it leaks every tenant's users.
  assert.deepEqual(userFindCalls, [
    { where: { orgId: "org-7" }, orderBy: { name: "asc" } },
  ]);
  assert.equal(lockFindCalls.length, 1);
});

// Note: user creation moved out of `handleAdminUsersAction` — the
// /admin/users route action now calls `inviteUser` directly (see
// app/domain/admin-users/invite-user.server.ts and its dedicated tests).

test("handleAdminUsersAction gates password-reset toggles to admins and writes typed org data", async () => {
  const nonAdmin = prismaFixture();
  const denied = await handleAdminUsersAction({
    formData: formData({ action: "setPasswordResetEnabled", enabled: true }),
    requestHeaders: new Headers(),
    requestUrl: "https://school.example.org/admin/users",
    actor: actor("CONTROLLER"),
    org: org(),
    prisma: nonAdmin.prisma,
    auth: auth(),
    hashPassword: async () => "unused",
    viewerAccess: viewerAccess(),
  });

  assert.deepEqual(denied, {
    kind: "error",
    data: null,
    message: { key: "admin:users.errors.onlyAdmins" },
  });
  assert.deepEqual(nonAdmin.calls.orgUpdates, []);

  const admin = prismaFixture();
  const enabled = await handleAdminUsersAction({
    formData: formData({ action: "setPasswordResetEnabled", enabled: true }),
    requestHeaders: new Headers(),
    requestUrl: "https://school.example.org/admin/users",
    actor: actor("ADMIN"),
    org: org(),
    prisma: admin.prisma,
    auth: auth(),
    hashPassword: async () => "unused",
    viewerAccess: viewerAccess(),
  });

  assert.equal(enabled.kind, "success");
  assert.deepEqual(admin.calls.orgUpdates, [
    {
      where: { id: "org-1" },
      data: { passwordResetEnabled: true },
    },
  ]);
});

test("handleAdminUsersAction creates encoded viewer magic links through the viewer-access dependency", async () => {
  const { prisma } = prismaFixture();
  const magicLinkCalls: unknown[] = [];

  const outcome = await handleAdminUsersAction({
    formData: formData({ action: "createViewerMagicLink", daysValid: "3" }),
    requestHeaders: new Headers(),
    requestUrl: "https://school.example.org/admin/users",
    actor: actor(),
    org: org(),
    prisma,
    auth: auth(),
    hashPassword: async () => "unused",
    viewerAccess: viewerAccess({
      createMagicLink: async (...args) => {
        magicLinkCalls.push(args);
        return "raw token";
      },
    }),
  });

  assert.deepEqual(magicLinkCalls, [["admin-1", 3]]);
  assert.deepEqual(outcome, {
    kind: "success",
    data: {
      magicLink: "https://school.example.org/viewer-access?token=raw%20token",
    },
    message: {
      key: "admin:users.toasts.magicLinkCreated",
      params: { days: 3 },
    },
  });
});

/* ------------------------------------------------------------------ */
/* Tenant-scope guards on user-id mutations                           */
/* ------------------------------------------------------------------ */
//
// Every action that takes a `userId` from form data must call
// `requireTargetInOrg` first. Without that guard, a tenant admin can
// pass any user id (cross-tenant) and mutate it — the User/Session/
// Account tables are deliberately excluded from the Prisma tenant
// extension because better-auth needs unscoped access for sign-in.
//
// We exercise both branches per action:
//   1. Target is in the current org → mutation runs.
//   2. Target is in a different org (findFirst returns null) → action
//      throws a 404 Response and the underlying mutation is NOT called.

const userIdMutations: Array<{
  action: string;
  formExtras?: Record<string, string>;
  // Returns the list to inspect to confirm the mutation ran. Empty list
  // means the mutation was skipped.
  observedMutationCalls(calls: ReturnType<typeof prismaFixture>["calls"]): unknown[];
  // Optional — track whether a non-prisma side-effect (better-auth) ran.
  trackedAuthCall?: keyof AdminUsersAuth["api"];
}> = [
  {
    action: "resetPassword",
    observedMutationCalls: (c) => c.accountUpdates,
  },
  {
    action: "changeRole",
    formExtras: { role: "VIEWER" },
    observedMutationCalls: (c) => c.userUpdates,
  },
  {
    action: "revokeUserSessions",
    observedMutationCalls: (c) => c.sessionDeletes,
  },
  {
    action: "deleteUser",
    observedMutationCalls: (c) => c.userDeletes,
  },
  {
    action: "ban",
    formExtras: { banReason: "spam" },
    observedMutationCalls: () => [],
    trackedAuthCall: "banUser",
  },
  {
    action: "unban",
    observedMutationCalls: () => [],
    trackedAuthCall: "unbanUser",
  },
];

for (const {
  action: actionName,
  formExtras,
  observedMutationCalls,
  trackedAuthCall,
} of userIdMutations) {
  test(`handleAdminUsersAction[${actionName}] refuses cross-tenant userId with 404 and skips the mutation`, async () => {
    const fx = prismaFixture({ targetInOrg: false });
    const authCalls: unknown[] = [];
    const customAuth = auth(
      trackedAuthCall
        ? {
            [trackedAuthCall]: async (args: unknown) => {
              authCalls.push(args);
            },
          } as Partial<AdminUsersAuth["api"]>
        : {},
    );

    let thrown: unknown = null;
    try {
      await handleAdminUsersAction({
        formData: formData({
          action: actionName,
          userId: "stranger-user",
          ...(formExtras ?? {}),
        }),
        requestHeaders: new Headers(),
        requestUrl: "https://school.example.org/admin/users",
        actor: actor(),
        org: org({ id: "org-current" }),
        prisma: fx.prisma,
        auth: customAuth,
        hashPassword: async () => "unused",
        viewerAccess: viewerAccess(),
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown instanceof Response, `expected Response, got ${thrown}`);
    assert.equal((thrown as Response).status, 404);

    // Tenant guard ran — and against the right org.
    assert.deepEqual(fx.calls.userFindFirstArgs, [
      {
        where: { id: "stranger-user", orgId: "org-current" },
        select: { id: true },
      },
    ]);
    // …and the actual mutation did NOT run.
    assert.deepEqual(observedMutationCalls(fx.calls), []);
    if (trackedAuthCall) {
      assert.deepEqual(authCalls, []);
    }
  });

  test(`handleAdminUsersAction[${actionName}] succeeds when the userId is in the current org`, async () => {
    const fx = prismaFixture({ targetInOrg: true });
    const authCalls: unknown[] = [];
    const customAuth = auth(
      trackedAuthCall
        ? {
            [trackedAuthCall]: async (args: unknown) => {
              authCalls.push(args);
            },
          } as Partial<AdminUsersAuth["api"]>
        : {},
    );

    const outcome = await handleAdminUsersAction({
      formData: formData({
        action: actionName,
        userId: "in-org-user",
        ...(formExtras ?? {}),
      }),
      requestHeaders: new Headers(),
      requestUrl: "https://school.example.org/admin/users",
      actor: actor(),
      org: org({ id: "org-current" }),
      prisma: fx.prisma,
      auth: customAuth,
      hashPassword: async () => "unused",
      viewerAccess: viewerAccess(),
    });

    assert.notEqual(outcome.kind, "error");
    // Mutation actually ran.
    if (trackedAuthCall) {
      assert.equal(authCalls.length, 1);
    } else {
      assert.equal(observedMutationCalls(fx.calls).length, 1);
    }
  });
}
