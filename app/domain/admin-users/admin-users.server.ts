import type { Org, PrismaClient, User, ViewerAccessAttempt } from "~/db";
import { z } from "zod";
import { zfd } from "zod-form-data";

const TEMP_PASSWORD_CHARS =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 12;

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

export type AdminUsersActionOutcome =
  | {
      kind: "success";
      data: AdminUsersFetcherData | null;
      message: string;
    }
  | {
      kind: "error";
      data: null;
      message: string;
    }
  | {
      kind: "warning";
      data: null;
      message: string;
    };

export type AdminUsersAuth = {
  api: {
    createUser(args: {
      body: {
        name: string;
        email: string;
        password: string;
        data: { mustChangePassword: true };
      };
      headers: Headers;
    }): Promise<{ user?: { id: string } } | null | undefined>;
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

const createUserSchema = zfd.formData({
  action: zfd.text(),
  name: zfd.text(),
  email: zfd.text(z.string().email()),
  role: zfd.text(),
});

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

  if (action === "createUser") {
    const { name, email, role } = createUserSchema.parse(formData);
    const tempPassword = makeTempPassword();
    try {
      const result = await auth.api.createUser({
        body: {
          name,
          email,
          password: tempPassword,
          data: { mustChangePassword: true },
        },
        headers: requestHeaders,
      });
      if (!result?.user) throw new Error("Failed to create user");
      await prisma.user.update({
        where: { id: result.user.id },
        data: { role },
      });
      return {
        kind: "success",
        data: { tempPassword },
        message: `User created! Temp password: ${tempPassword}`,
      };
    } catch (error) {
      if (isDuplicateUserError(error)) {
        return {
          kind: "error",
          data: null,
          message: "An account with that email already exists.",
        };
      }
      return { kind: "error", data: null, message: "Failed to create user." };
    }
  }

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
        message: "No credential account found.",
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
      message: `Password reset! New temp password: ${tempPassword}`,
    };
  }

  if (action === "changeRole") {
    const { userId, role } = changeRoleSchema.parse(formData);
    await prisma.user.update({ where: { id: userId }, data: { role } });
    return { kind: "success", data: null, message: "Role updated." };
  }

  if (action === "revokeUserSessions") {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      return { kind: "error", data: null, message: "Missing user id." };
    }
    const result = await prisma.session.deleteMany({ where: { userId } });
    return {
      kind: "success",
      data: null,
      message: `Revoked ${result.count} active session(s).`,
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
        ? `Viewer PIN updated. Revoked ${revoked} viewer session(s).`
        : "Viewer PIN updated.",
    };
  }

  if (action === "resetViewerLock") {
    const { clientKey } = resetViewerLockSchema.parse(formData);
    await viewerAccess.resetLock(clientKey);
    return { kind: "success", data: null, message: "Viewer lock reset." };
  }

  if (action === "createViewerMagicLink") {
    const { daysValid } = createMagicLinkSchema.parse(formData);
    const token = await viewerAccess.createMagicLink(actor.id, daysValid);
    return {
      kind: "success",
      data: { magicLink: buildViewerMagicLink(requestUrl, token) },
      message: `Magic link created. Valid for ${daysValid} day(s).`,
    };
  }

  if (action === "setPasswordResetEnabled") {
    if (actor.role !== "ADMIN") {
      return {
        kind: "error",
        data: null,
        message: "Only admins can change this setting.",
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
        ? "Password reset is now enabled for your org."
        : "Password reset is now disabled. Users must sign in via SSO once configured.",
    };
  }

  if (action === "deleteUser") {
    const userId = uncheckedFormText(formData, "userId");
    await prisma.user.delete({ where: { id: userId } });
    return { kind: "warning", data: null, message: "User deleted." };
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
    return { kind: "success", data: null, message: "User banned." };
  }

  if (action === "unban") {
    const userId = uncheckedFormText(formData, "userId");
    await auth.api.unbanUser({ body: { userId }, headers: requestHeaders });
    return { kind: "success", data: null, message: "User unbanned." };
  }

  return { kind: "error", data: null, message: "Unknown action" };
}
