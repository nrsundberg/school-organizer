import { useFetcher } from "react-router";
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableContent, TableHeader, TableRow } from "@heroui/react";
import { Ban, KeyRound, Link as LinkIcon, LogIn, RotateCcw, ShieldX, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/users";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getPrisma } from "~/db.server";
import { getAuth, hashPassword } from "~/domain/auth/better-auth.server";
import { authClient } from "~/lib/auth-client";
import { dataWithError, dataWithSuccess, dataWithWarning } from "remix-toast";
import { createViewerMagicLink, resetViewerLock, revokeAllViewerSessions, setViewerPin } from "~/domain/auth/viewer-access.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import {
  handleAdminUsersAction,
  loadAdminUsersData,
  type AdminUsersActionOutcome,
  type AdminUsersAuth,
  type AdminUsersFetcherData,
} from "~/domain/admin-users/admin-users.server";
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import type { TFunction } from "i18next";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Admin – Users" },
];

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
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return { ...data, metaTitle: t("users.metaTitle") };
}

function dataWithToast(outcome: AdminUsersActionOutcome, t: TFunction) {
  // Server returns translation-ready keys; we resolve at the route boundary
  // so the toast lands in the user's active locale.
  const message = t(outcome.message.key, outcome.message.params ?? {});
  if (outcome.kind === "success") {
    return dataWithSuccess(outcome.data, message);
  }
  if (outcome.kind === "warning") {
    return dataWithWarning(outcome.data, message);
  }
  return dataWithError(outcome.data, message);
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const auth: AdminUsersAuth = getAuth(context);
  const formData = await request.formData();
  const org = getOrgFromContext(context);
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, ["admin", "errors"]);
  const outcome = await handleAdminUsersAction({
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
  return dataWithToast(outcome, t);
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

  const fetcherData = userFetcher.data as AdminUsersFetcherData | undefined;
  type AdminUserTableRow = (typeof users)[number];

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
            {fetcherData?.viewerPin ? (
              <p className="text-xs text-yellow-300">New PIN: {fetcherData.viewerPin}</p>
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
            {fetcherData?.magicLink ? (
              <p className="text-xs text-green-300 break-all">{fetcherData.magicLink}</p>
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
            <TableBody<AdminUserTableRow> items={users}>
              {(user) => (
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
                      <BanButton user={user} currentUserId={currentUserId} />
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
