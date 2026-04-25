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
      createUser: async () => ({ user: { id: "created-user" } }),
      banUser: async () => {},
      unbanUser: async () => {},
      ...overrides,
    },
  };
}

function prismaFixture() {
  const userUpdates: unknown[] = [];
  const orgUpdates: unknown[] = [];
  const accountUpdates: unknown[] = [];
  const sessionDeletes: unknown[] = [];

  const prisma = {
    user: {
      findMany: async () => [],
      update: async (args: unknown) => {
        userUpdates.push(args);
        return {};
      },
      delete: async () => ({}),
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
    calls: { userUpdates, orgUpdates, accountUpdates, sessionDeletes },
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
    org: org({ passwordResetEnabled: false }),
    currentUserId: "u1",
  });

  assert.equal(result.users, users);
  assert.equal(result.locks, locks);
  assert.equal(result.currentUserId, "u1");
  assert.equal(result.passwordResetEnabled, false);
  assert.deepEqual(userFindCalls, [{ orderBy: { name: "asc" } }]);
  assert.equal(lockFindCalls.length, 1);
});

test("handleAdminUsersAction creates a user with a temporary password and then applies the requested role", async () => {
  const { prisma, calls } = prismaFixture();
  const createCalls: unknown[] = [];

  const outcome = await handleAdminUsersAction({
    formData: formData({
      action: "createUser",
      name: "Ada Lovelace",
      email: "ada@example.org",
      role: "CONTROLLER",
    }),
    requestHeaders: new Headers({ cookie: "session=1" }),
    requestUrl: "https://school.example.org/admin/users",
    actor: actor(),
    org: org(),
    prisma,
    auth: auth({
      createUser: async (args) => {
        createCalls.push(args);
        return { user: { id: "created-user" } };
      },
    }),
    hashPassword: async () => "unused",
    viewerAccess: viewerAccess(),
    makeTempPassword: () => "TempPass123",
  });

  // Outcome carries a translation-ready ServerMessage rather than a string —
  // route boundary will resolve via t(key, params).
  assert.deepEqual(outcome, {
    kind: "success",
    data: { tempPassword: "TempPass123" },
    message: {
      key: "admin:users.toasts.userCreated",
      params: { password: "TempPass123" },
    },
  });
  assert.deepEqual(createCalls, [
    {
      body: {
        name: "Ada Lovelace",
        email: "ada@example.org",
        password: "TempPass123",
        data: { mustChangePassword: true },
      },
      headers: new Headers({ cookie: "session=1" }),
    },
  ]);
  assert.deepEqual(calls.userUpdates, [
    { where: { id: "created-user" }, data: { role: "CONTROLLER" } },
  ]);
});

test("handleAdminUsersAction returns the duplicate-account toast outcome without updating role", async () => {
  const { prisma, calls } = prismaFixture();

  const outcome = await handleAdminUsersAction({
    formData: formData({
      action: "createUser",
      name: "Ada Lovelace",
      email: "ada@example.org",
      role: "ADMIN",
    }),
    requestHeaders: new Headers(),
    requestUrl: "https://school.example.org/admin/users",
    actor: actor(),
    org: org(),
    prisma,
    auth: auth({
      createUser: async () => {
        throw Object.assign(new Error("account already exists"), {
          status: 422,
        });
      },
    }),
    hashPassword: async () => "unused",
    viewerAccess: viewerAccess(),
    makeTempPassword: () => "TempPass123",
  });

  assert.deepEqual(outcome, {
    kind: "error",
    data: null,
    message: { key: "admin:users.errors.emailExists" },
  });
  assert.deepEqual(calls.userUpdates, []);
});

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
