import type { Org, PrismaClient, User, ViewerAccessAttempt } from "~/db";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { ServerMessage } from "~/domain/types/server-message";

const TEMP_PASSWORD_CHARS =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 12;

// New-user creation goes through the magic-link invite flow handled
// directly by the route action (see app/routes/admin/users.tsx). This
// shared handler still owns reset-password, change-role, ban, etc. — it
// just doesn't mint plaintext passwords for brand-new users anymore.

export type AdminUsersPrisma = Pick<
  PrismaClient,
  "account" | "org" | "session" | "user"
>;
export type AdminUsersTenantPrisma = Pick<
  PrismaClient,
  "viewerAccessAttempt"
>;
export type AdminUserActor = Pick<User, "id" | "role">;

export type AdminUsersFetcherData = {
  tempPassword?: string;
  viewerPin?: string;
  magicLink?: string;
};

export type AdminUsersLoaderData = {
  users: User[];
  locks: ViewerAccessAttempt[];
  currentUserId: string;
  passwordResetEnabled: boolean;
};

/**
 * Outcome of an admin-users action handler. Carries a translation-ready
 * {@link ServerMessage} (instead of an English string) so the route
 * boundary can render it in the active locale via `t(message.key, ...)`.
 *
 * `kind` distinguishes which remix-toast helper the route should call
 * (`dataWithSuccess` / `dataWithWarning` / `dataWithError`). `data`
 * carries fetcher payloads (temp passwords, magic links) for the UI.
 */
export type AdminUsersActionOutcome =
  | {
      kind: "success";
      data: AdminUsersFetcherData | null;
      message: ServerMessage;
    }
  | {
      kind: "error";
      data: null;
      message: ServerMessage;
    }
  | {
      kind: "warning";
      data: null;
      message: ServerMessage;
    };

export type AdminUsersAuth = {
  api: {
    banUser(args: {
      body: { userId: string; banReason: string };
      headers: Headers;
    }): Promise<unknown>;
    unbanUser(args: {
      body: { userId: string };
      headers: Headers;
    }): Promise<unknown>;
  };
};

export type AdminUsersViewerAccess = {
  setPin(pin: string): Promise<void>;
  revokeAllSessions(): Promise<number>;
  resetLock(clientKey: string): Promise<void>;
  createMagicLink(
    createdByUserId: string | null,
    daysValid: number,
  ): Promise<string>;
};

type HashPassword = (password: string) => Promise<string>;
type TempPasswordGenerator = () => string;

export type LoadAdminUsersDataArgs = {
  prisma: AdminUsersPrisma;
  tenantPrisma: AdminUsersTenantPrisma;
  org: Org;
  currentUserId: string;
};

export type HandleAdminUsersActionArgs = {
  formData: FormData;
  requestHeaders: Headers;
  requestUrl: string;
  actor: AdminUserActor;
  org: Org;
  prisma: AdminUsersPrisma;
  auth: AdminUsersAuth;
  hashPassword: HashPassword;
  viewerAccess: AdminUsersViewerAccess;
  makeTempPassword?: TempPasswordGenerator;
};

const resetPasswordSchema = zfd.formData({
  action: zfd.text(),
  userId: zfd.text(),
});

const changeRoleSchema = zfd.formData({
  action: zfd.text(),
  userId: zfd.text(),
  role: zfd.text(),
});

const setViewerPinSchema = zfd.formData({
  action: zfd.text(),
  pin: zfd.text(z.string().trim().min(4).max(32)),
  revokeViewerSessions: zfd.checkbox().optional(),
});

const resetViewerLockSchema = zfd.formData({
  action: zfd.text(),
  clientKey: zfd.text(),
});

const createMagicLinkSchema = zfd.formData({
  action: zfd.text(),
  daysValid: zfd.numeric(z.number().int().min(1).max(30)),
});

const setPasswordResetEnabledSchema = zfd.formData({
  action: zfd.text(),
  enabled: zfd.checkbox().optional(),
});

function formAction(formData: FormData): string {
  const action = formData.get("action");
  return typeof action === "string" ? action : "";
}

function uncheckedFormText(formData: FormData, key: string): string {
  return formData.get(key) as string;
}

function objectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function isDuplicateUserError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : objectProperty(error, "message");
  const status = objectProperty(error, "status");
  return (
    (typeof message === "string" && message.includes("already exists")) ||
    status === 422
  );
}

export function generateTempPassword(
  getRandomValues: (array: Uint8Array) => Uint8Array = (array) =>
    crypto.getRandomValues(array),
): string {
  let result = "";
  const array = new Uint8Array(TEMP_PASSWORD_LENGTH);
  getRandomValues(array);
  for (const byte of array) {
    result += TEMP_PASSWORD_CHARS[byte % TEMP_PASSWORD_CHARS.length];
  }
  return result;
}

export function buildViewerMagicLink(requestUrl: string, token: string): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}/viewer-access?token=${encodeURIComponent(token)}`;
}

export async function loadAdminUsersData({
  prisma,
  tenantPrisma,
  org,
  currentUserId,
}: LoadAdminUsersDataArgs): Promise<AdminUsersLoaderData> {
  const [users, locks] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    tenantPrisma.viewerAccessAttempt.findMany({
      where: {
        OR: [
          { requiresAdminReset: true },
          { lockedUntil: { gt: new Date() } },
        ],
      },
      orderBy: [{ requiresAdminReset: "desc" }, { updatedAt: "desc" }],
    }),
  ]);

  return {
    users,
    locks,
    currentUserId,
    passwordResetEnabled: org.passwordResetEnabled !== false,
  };
}

export async function handleAdminUsersAction({
  formData,
  requestHeaders,
  requestUrl,
  actor,
  org,
  prisma,
  auth,
  hashPassword,
  viewerAccess,
  makeTempPassword = generateTempPassword,
}: HandleAdminUsersActionArgs): Promise<AdminUsersActionOutcome> {
  const action = formAction(formData);

  // `createUser` is no longer handled here — see /admin/users.tsx route
  // action, which calls inviteUser (the magic-link flow) directly. We
  // intentionally do not return a misleading success here; if a stale
  // form ever posts `action=createUser`, fall through to the unknown
  // action error so we notice instead of silently swallowing it.

  if (action === "resetPassword") {
    const { userId } = resetPasswordSchema.parse(formData);
    const tempPassword = makeTempPassword();
    const hashed = await hashPassword(tempPassword);
    const account = await prisma.account.findFirst({
      where: { userId, providerId: "credential" },
    });
    if (!account) {
      return {
        kind: "error",
        data: null,
        message: { key: "admin:users.errors.noCredential" },
      };
    }
    await prisma.account.update({
      where: { id: account.id },
      data: { password: hashed },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: true },
    });
    return {
      kind: "success",
      data: { tempPassword },
      message: {
        key: "admin:users.toasts.passwordReset",
        params: { password: tempPassword },
      },
    };
  }

  if (action === "changeRole") {
    const { userId, role } = changeRoleSchema.parse(formData);
    await prisma.user.update({ where: { id: userId }, data: { role } });
    return {
      kind: "success",
      data: null,
      message: { key: "admin:users.toasts.roleUpdated" },
    };
  }

  if (action === "revokeUserSessions") {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      return {
        kind: "error",
        data: null,
        message: { key: "admin:users.errors.missingId" },
      };
    }
    const result = await prisma.session.deleteMany({ where: { userId } });
    return {
      kind: "success",
      data: null,
      message: {
        key: "admin:users.toasts.sessionsRevoked",
        params: { count: result.count },
      },
    };
  }

  if (action === "setViewerPin") {
    const { pin, revokeViewerSessions: revokeFlag } =
      setViewerPinSchema.parse(formData);
    await viewerAccess.setPin(pin);
    let revoked = 0;
    if (revokeFlag) {
      revoked = await viewerAccess.revokeAllSessions();
    }
    return {
      kind: "success",
      data: { viewerPin: pin },
      message: revokeFlag
        ? {
            key: "admin:users.toasts.viewerPinRevoked",
            params: { count: revoked },
          }
        : { key: "admin:users.toasts.viewerPinUpdated" },
    };
  }

  if (action === "resetViewerLock") {
    const { clientKey } = resetViewerLockSchema.parse(formData);
    await viewerAccess.resetLock(clientKey);
    return {
      kind: "success",
      data: null,
      message: { key: "admin:users.toasts.viewerLockReset" },
    };
  }

  if (action === "createViewerMagicLink") {
    const { daysValid } = createMagicLinkSchema.parse(formData);
    const token = await viewerAccess.createMagicLink(actor.id, daysValid);
    return {
      kind: "success",
      data: { magicLink: buildViewerMagicLink(requestUrl, token) },
      message: {
        key: "admin:users.toasts.magicLinkCreated",
        params: { days: daysValid },
      },
    };
  }

  if (action === "setPasswordResetEnabled") {
    if (actor.role !== "ADMIN") {
      return {
        kind: "error",
        data: null,
        message: { key: "admin:users.errors.onlyAdmins" },
      };
    }
    const parsed = setPasswordResetEnabledSchema.parse(formData);
    const enabled = parsed.enabled === true;
    await prisma.org.update({
      where: { id: org.id },
      data: { passwordResetEnabled: enabled },
    });
    return {
      kind: "success",
      data: null,
      message: enabled
        ? { key: "admin:users.toasts.passwordResetEnabled" }
        : { key: "admin:users.toasts.passwordResetDisabled" },
    };
  }

  if (action === "deleteUser") {
    const userId = uncheckedFormText(formData, "userId");
    await prisma.user.delete({ where: { id: userId } });
    return {
      kind: "warning",
      data: null,
      message: { key: "admin:users.toasts.userDeleted" },
    };
  }

  if (action === "ban") {
    const userId = uncheckedFormText(formData, "userId");
    const reason = formData.get("banReason");
    const banReason =
      typeof reason === "string" && reason ? reason : "Banned by admin";
    await auth.api.banUser({
      body: { userId, banReason },
      headers: requestHeaders,
    });
    return {
      kind: "success",
      data: null,
      message: { key: "admin:users.toasts.userBanned" },
    };
  }

  if (action === "unban") {
    const userId = uncheckedFormText(formData, "userId");
    await auth.api.unbanUser({ body: { userId }, headers: requestHeaders });
    return {
      kind: "success",
      data: null,
      message: { key: "admin:users.toasts.userUnbanned" },
    };
  }

  return {
    kind: "error",
    data: null,
    message: { key: "admin:users.errors.unknown" },
  };
}
