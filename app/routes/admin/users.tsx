import { useFetcher } from "react-router";
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableContent, TableHeader, TableRow } from "@heroui/react";
import { Ban, KeyRound, Link as LinkIcon, LogIn, RotateCcw, ShieldX, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/users";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { hashPassword } from "~/domain/auth/better-auth.server";
import { authClient } from "~/lib/auth-client";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { createViewerMagicLink, resetViewerLock, revokeAllViewerSessions, setViewerPin } from "~/domain/auth/viewer-access.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Users" },
];

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let result = "";
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  for (const byte of array) result += chars[byte % chars.length];
  return result;
}

// TODO: wire localized errorMap once Agent C ships `makeZodErrorMap`. Until
// then schemas surface zod default messages; user-facing toasts on validation
// failure are translated at the action site.
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const tenantPrisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const [users, locks] = await Promise.all([
    // SECURITY: User is intentionally outside the tenant Prisma extension
    // (it's a better-auth table; signup creates rows before an org exists),
    // so we MUST filter explicitly here. Without this where clause, the
    // list renders every user on the platform — cross-tenant leak. The
    // middleware bounces regular tenant admins away from other tenants'
    // admin routes, but platform admins bypass that bounce, so a platform
    // admin viewing a tenant admin page would otherwise see everyone.
    prisma.user.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
    }),
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
  // `passwordResetEnabled` is missing from the generated Prisma type until
  // `prisma generate` re-runs. Cast at the boundary rather than weakening
  // the rest of the loader. Default to true if the column is null/missing.
  const orgAny = org as any;
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    users,
    locks,
    currentUserId: me.id,
    passwordResetEnabled: orgAny.passwordResetEnabled !== false,
    metaTitle: t("users.metaTitle"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const auth = getAuth(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  /**
   * SECURITY: every action that accepts a `userId` from form data must
   * go through this guard. It verifies the target user exists AND
   * belongs to the current tenant — otherwise an admin on tenant A
   * could mutate a user in tenant B by crafting a POST with the right
   * userId. The middleware bounces regular cross-tenant navigations,
   * but platform admins bypass that bounce, and even a well-meaning
   * platform admin operating on a tenant admin page should be scoped
   * to that tenant's users. Returns the user row on success so callers
   * don't re-query.
   */
  async function requireUserInOrg(userId: string) {
    if (!userId) {
      return { error: dataWithError(null, t("users.errors.missingId")) };
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgId: true },
    });
    if (!user || user.orgId !== org.id) {
      // Deliberately vague — don't leak existence of users in other tenants.
      return { error: dataWithError(null, t("users.errors.userNotFound")) };
    }
    return { user };
  }

  if (action === "createUser") {
    const { name, email, role } = createUserSchema.parse(formData);
    const tempPassword = generateTempPassword();
    try {
      const result = await auth.api.createUser({
        body: { name, email, password: tempPassword, data: { mustChangePassword: true } },
        headers: request.headers,
      });
      if (!result?.user) throw new Error("Failed to create user");
      // Stamp orgId and role in a single update so the user is bound to
      // this tenant from the moment they can log in. Without this the
      // user row has orgId=null and they'd be treated as mid-signup (the
      // middleware would punt them to /signup).
      await prisma.user.update({
        where: { id: result.user.id },
        data: { role, orgId: org.id },
      });
      return dataWithSuccess(
        { tempPassword },
        t("users.toasts.userCreated", { password: tempPassword }),
      );
    } catch (e: any) {
      if (e?.message?.includes("already exists") || e?.status === 422) {
        return dataWithError(null, t("users.errors.emailExists"));
      }
      return dataWithError(null, t("users.errors.createUserFailed"));
    }
  }

  if (action === "resetPassword") {
    const { userId } = resetPasswordSchema.parse(formData);
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    const tempPassword = generateTempPassword();
    const hashed = await hashPassword(tempPassword);
    const account = await prisma.account.findFirst({ where: { userId, providerId: "credential" } });
    if (!account) return dataWithError(null, t("users.errors.noCredential"));
    await prisma.account.update({ where: { id: account.id }, data: { password: hashed } });
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    return dataWithSuccess(
      { tempPassword },
      t("users.toasts.passwordReset", { password: tempPassword }),
    );
  }

  if (action === "changeRole") {
    const { userId, role } = changeRoleSchema.parse(formData);
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    await prisma.user.update({ where: { id: userId }, data: { role } });
    return dataWithSuccess(null, t("users.toasts.roleUpdated"));
  }

  if (action === "revokeUserSessions") {
    const userId = String(formData.get("userId") ?? "");
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    const result = await prisma.session.deleteMany({ where: { userId } });
    return dataWithSuccess(null, t("users.toasts.sessionsRevoked", { count: result.count }));
  }

  if (action === "setViewerPin") {
    const { pin, revokeViewerSessions: revokeFlag } = setViewerPinSchema.parse(formData);
    await setViewerPin(context, pin);
    let revoked = 0;
    if (revokeFlag) {
      revoked = await revokeAllViewerSessions(context);
    }
    return dataWithSuccess(
      { viewerPin: pin },
      revokeFlag
        ? t("users.toasts.viewerPinRevoked", { count: revoked })
        : t("users.toasts.viewerPinUpdated"),
    );
  }

  if (action === "resetViewerLock") {
    const { clientKey } = resetViewerLockSchema.parse(formData);
    await resetViewerLock(context, clientKey);
    return dataWithSuccess(null, t("users.toasts.viewerLockReset"));
  }

  if (action === "createViewerMagicLink") {
    const { daysValid } = createMagicLinkSchema.parse(formData);
    const token = await createViewerMagicLink(context, me.id, daysValid);
    const origin = new URL(request.url).origin;
    const link = `${origin}/viewer-access?token=${encodeURIComponent(token)}`;
    return dataWithSuccess(
      { magicLink: link },
      t("users.toasts.magicLinkCreated", { days: daysValid }),
    );
  }

  if (action === "setPasswordResetEnabled") {
    if (me.role !== "ADMIN") {
      return dataWithError(null, t("users.errors.onlyAdmins"));
    }
    const parsed = setPasswordResetEnabledSchema.parse(formData);
    const enabled = parsed.enabled === true;
    const org = getOrgFromContext(context);
    // Cast the update input: the generated Prisma type doesn't know about
    // `passwordResetEnabled` yet (see comment in loader).
    await (prisma.org as any).update({
      where: { id: org.id },
      data: { passwordResetEnabled: enabled },
    });
    return dataWithSuccess(
      null,
      enabled
        ? t("users.toasts.passwordResetEnabled")
        : t("users.toasts.passwordResetDisabled"),
    );
  }

  if (action === "deleteUser") {
    const userId = formData.get("userId") as string;
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    await prisma.user.delete({ where: { id: userId } });
    return dataWithWarning(null, t("users.toasts.userDeleted"));
  }

  if (action === "ban") {
    const userId = formData.get("userId") as string;
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    const banReason = (formData.get("banReason") as string) || "Banned by admin";
    await auth.api.banUser({ body: { userId, banReason }, headers: request.headers });
    return dataWithSuccess(null, t("users.toasts.userBanned"));
  }

  if (action === "unban") {
    const userId = formData.get("userId") as string;
    const guard = await requireUserInOrg(userId);
    if ("error" in guard) return guard.error;
    await auth.api.unbanUser({ body: { userId }, headers: request.headers });
    return dataWithSuccess(null, t("users.toasts.userUnbanned"));
  }

  return dataWithError(null, t("users.errors.unknown"));
}

function BanButton({ user, currentUserId }: { user: { id: string; name: string; banned: boolean; banReason: string | null }; currentUserId: string }) {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isSelf = user.id === currentUserId;

  if (isSelf) return null;

  if (user.banned) {
    return (
      <fetcher.Form method="post">
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="action" value="unban" />
        <Button size="sm" variant="ghost" type="submit" isDisabled={fetcher.state !== "idle"}>
          <UserCheck className="w-3 h-3" />
          {t("users.table.unban")}
        </Button>
      </fetcher.Form>
    );
  }

  return (
    <>
      <Button size="sm" variant="ghost" onPress={() => setOpen(true)}>
        <Ban className="w-3 h-3" />
        {t("users.table.ban")}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-[#1a1f1f] border border-white/10 rounded-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">{t("users.ban.heading", { name: user.name })}</h3>
            <p className="text-white/50 text-sm mb-4">{t("users.ban.body")}</p>
            <label className="text-sm text-white/60 mb-1 block">{t("users.ban.reasonLabel")}</label>
            <input
              className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white text-sm mb-4 outline-none focus:border-blue-500"
              placeholder={t("users.ban.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>{tCommon("buttons.cancel")}</Button>
              <fetcher.Form method="post" onSubmit={() => setOpen(false)}>
                <input type="hidden" name="action" value="ban" />
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="banReason" value={reason} />
                <Button size="sm" variant="danger" type="submit" isDisabled={!reason || fetcher.state !== "idle"}>
                  {t("users.ban.submit")}
                </Button>
              </fetcher.Form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ImpersonateButton({ user, currentUserId }: { user: { id: string; name: string }; currentUserId: string }) {
  const { t } = useTranslation("admin");
  const [isLoading, setIsLoading] = useState(false);
  if (user.id === currentUserId) return null;

  return (
    <Button
      size="sm"
      variant="ghost"
      isDisabled={isLoading}
      onPress={async () => {
        setIsLoading(true);
        const { error } = await authClient.admin.impersonateUser({ userId: user.id });
        if (error) {
          setIsLoading(false);
        } else {
          window.location.href = "/";
        }
      }}
    >
      <LogIn className="w-3 h-3" />
      {isLoading ? t("users.table.impersonating") : t("users.table.impersonate")}
    </Button>
  );
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, locks, currentUserId, passwordResetEnabled } = loaderData;
  const { t, i18n } = useTranslation("admin");
  const userFetcher = useFetcher();
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("CONTROLLER");
  const [viewerPin, setViewerPinState] = useState("");
  const [daysValid, setDaysValid] = useState("7");

  const anyFetcherData = userFetcher.data as
    | { tempPassword?: string; viewerPin?: string; magicLink?: string }
    | undefined;

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-bold text-white">{t("users.heading")}</h1>

      <section className="rounded-xl border border-white/10 p-4 bg-white/[0.02]">
        <h2 className="text-white font-semibold text-base mb-3">{t("users.passwordReset.heading")}</h2>
        <userFetcher.Form method="post" className="flex flex-col gap-2">
          <input type="hidden" name="action" value="setPasswordResetEnabled" />
          {/*
            Uncontrolled checkbox: submitting the form immediately toggles
            the value. When unchecked, the form posts no `enabled` field,
            which `zfd.checkbox()` reads as false.
          */}
          <label className="inline-flex items-center gap-2 text-sm text-white/85">
            <input
              type="checkbox"
              name="enabled"
              value="on"
              defaultChecked={passwordResetEnabled}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            {t("users.passwordReset.label")}
          </label>
          {!passwordResetEnabled && (
            <p className="text-xs text-white/55">
              {t("users.passwordReset.ssoHint")}
            </p>
          )}
        </userFetcher.Form>
      </section>

      <section className="rounded-xl border border-white/10 p-4 bg-white/[0.02]">
        <h2 className="text-white font-semibold text-base mb-3">{t("users.viewer.heading")}</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm text-white/70 font-medium">{t("users.viewer.resetPin")}</h3>
            <userFetcher.Form method="post" className="space-y-3">
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
              <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle" || viewerPin.trim().length < 4}>
                <KeyRound className="w-4 h-4" />
                {t("users.viewer.savePin")}
              </Button>
            </userFetcher.Form>
            {anyFetcherData?.viewerPin ? (
              <p className="text-xs text-yellow-300">{t("users.viewer.newPin", { pin: anyFetcherData.viewerPin })}</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm text-white/70 font-medium">{t("users.viewer.createMagicLink")}</h3>
            <userFetcher.Form method="post" className="space-y-3">
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
              <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle"}>
                <LinkIcon className="w-4 h-4" />
                {t("users.viewer.generateLink")}
              </Button>
            </userFetcher.Form>
            {anyFetcherData?.magicLink ? (
              <p className="text-xs text-green-300 break-all">{anyFetcherData.magicLink}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm text-white/70 font-medium mb-2">{t("users.viewer.lockedClients")}</h3>
          {locks.length === 0 ? (
            <p className="text-sm text-white/50">{t("users.viewer.noLockouts")}</p>
          ) : (
            <div className="space-y-2">
              {locks.map((lock: { clientKey: string; ipHint: string | null; requiresAdminReset: boolean; lockedUntil: string | Date | null }) => (
                <div key={lock.clientKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2">
                  <div className="text-sm text-white/80">
                    {lock.ipHint ?? t("users.viewer.unknownNetwork")} - {lock.requiresAdminReset
                      ? t("users.viewer.adminResetRequired")
                      : t("users.viewer.lockedUntil", {
                          when: lock.lockedUntil
                            ? new Date(lock.lockedUntil).toLocaleString(i18n.language)
                            : t("users.viewer.lockedUntilUnknown"),
                        })}
                  </div>
                  <userFetcher.Form method="post">
                    <input type="hidden" name="action" value="resetViewerLock" />
                    <input type="hidden" name="clientKey" value={lock.clientKey} />
                    <Button size="sm" variant="ghost" type="submit" isDisabled={userFetcher.state !== "idle"}>
                      <ShieldX className="w-3 h-3" />
                      {t("users.viewer.resetLock")}
                    </Button>
                  </userFetcher.Form>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Create user form */}
      <section>
        <h2 className="text-white font-semibold text-base mb-3">{t("users.create.heading")}</h2>
        <userFetcher.Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="action" value="createUser" />
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">{t("users.create.fullName")}</label>
            <Input name="name" required className="w-44" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">{t("users.create.email")}</label>
            <Input type="email" name="email" required className="w-52" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">{t("users.create.role")}</label>
            <select
              name="role"
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white w-32 text-sm"
            >
              <option value="CONTROLLER">{t("users.create.controller")}</option>
              <option value="ADMIN">{t("users.create.admin")}</option>
              <option value="VIEWER">{t("users.create.viewer")}</option>
            </select>
          </div>
          <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle"}>
            {t("users.create.submit")}
          </Button>
        </userFetcher.Form>
      </section>

      {/* Users table */}
      <section>
        <Table aria-label={t("users.table.ariaLabel")}>
          <TableContent>
            <TableHeader>
              <TableColumn isRowHeader>{t("users.table.name")}</TableColumn>
              <TableColumn>{t("users.table.email")}</TableColumn>
              <TableColumn>{t("users.table.role")}</TableColumn>
              <TableColumn>{t("users.table.status")}</TableColumn>
              <TableColumn>{t("users.table.actions")}</TableColumn>
            </TableHeader>
            <TableBody items={users as any[]}>
              {(user: any) => (
                <TableRow id={user.id} key={user.id}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <userFetcher.Form method="post">
                      <input type="hidden" name="action" value="changeRole" />
                      <input type="hidden" name="userId" value={user.id} />
                      <select
                        name="role"
                        defaultValue={user.role ?? "VIEWER"}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-white text-sm"
                      >
                        <option value="VIEWER">{t("users.create.viewer")}</option>
                        <option value="CONTROLLER">{t("users.create.controller")}</option>
                        <option value="ADMIN">{t("users.create.admin")}</option>
                      </select>
                    </userFetcher.Form>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                        {t("users.table.banned")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                        {t("users.table.active")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      <userFetcher.Form method="post">
                        <input type="hidden" name="action" value="resetPassword" />
                        <input type="hidden" name="userId" value={user.id} />
                        <Button size="sm" variant="ghost" type="submit" isDisabled={userFetcher.state !== "idle"}>
                          <RotateCcw className="w-3 h-3" />
                          {t("users.table.resetPw")}
                        </Button>
                      </userFetcher.Form>
                      <BanButton user={{ ...user, banned: user.banned ?? false }} currentUserId={currentUserId} />
                      <userFetcher.Form method="post">
                        <input type="hidden" name="action" value="revokeUserSessions" />
                        <input type="hidden" name="userId" value={user.id} />
                        <Button size="sm" variant="ghost" type="submit" isDisabled={userFetcher.state !== "idle"}>
                          <ShieldX className="w-3 h-3" />
                          {t("users.table.revokeSessions")}
                        </Button>
                      </userFetcher.Form>
                      <ImpersonateButton user={user} currentUserId={currentUserId} />
                      {user.id !== currentUserId && (
                        <userFetcher.Form method="post">
                          <input type="hidden" name="action" value="deleteUser" />
                          <input type="hidden" name="userId" value={user.id} />
                          <Button size="sm" variant="danger" type="submit" isDisabled={userFetcher.state !== "idle"}>
                            <Trash2 className="w-3 h-3" />
                            {t("users.table.delete")}
                          </Button>
                        </userFetcher.Form>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </TableContent>
        </Table>
      </section>
    </div>
  );
}
