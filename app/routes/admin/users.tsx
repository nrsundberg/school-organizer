import { useFetcher } from "react-router";
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableContent, TableHeader, TableRow } from "@heroui/react";
import { Ban, KeyRound, Link as LinkIcon, LogIn, RotateCcw, ShieldX, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
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

export const meta: Route.MetaFunction = () => [{ title: "Admin – Users" }];

export async function loader({ context }: Route.LoaderArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const tenantPrisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  return loadAdminUsersData({
    prisma,
    tenantPrisma,
    org,
    currentUserId: me.id,
  });
}

function dataWithToast(outcome: AdminUsersActionOutcome) {
  if (outcome.kind === "success") {
    return dataWithSuccess(outcome.data, outcome.message);
  }
  if (outcome.kind === "warning") {
    return dataWithWarning(outcome.data, outcome.message);
  }
  return dataWithError(outcome.data, outcome.message);
}

export async function action({ request, context }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getPrisma(context);
  const auth: AdminUsersAuth = getAuth(context);
  const formData = await request.formData();
  const org = getOrgFromContext(context);
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
  return dataWithToast(outcome);
}

function BanButton({ user, currentUserId }: { user: { id: string; name: string; banned: boolean; banReason: string | null }; currentUserId: string }) {
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
          Unban
        </Button>
      </fetcher.Form>
    );
  }

  return (
    <>
      <Button size="sm" variant="ghost" onPress={() => setOpen(true)}>
        <Ban className="w-3 h-3" />
        Ban
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-[#1a1f1f] border border-white/10 rounded-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">Ban {user.name}?</h3>
            <p className="text-white/50 text-sm mb-4">This will revoke their active sessions immediately.</p>
            <label className="text-sm text-white/60 mb-1 block">Reason</label>
            <input
              className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white text-sm mb-4 outline-none focus:border-blue-500"
              placeholder="Enter ban reason..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>Cancel</Button>
              <fetcher.Form method="post" onSubmit={() => setOpen(false)}>
                <input type="hidden" name="action" value="ban" />
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="banReason" value={reason} />
                <Button size="sm" variant="danger" type="submit" isDisabled={!reason || fetcher.state !== "idle"}>
                  Ban User
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
      {isLoading ? "..." : "Impersonate"}
    </Button>
  );
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, locks, currentUserId, passwordResetEnabled } = loaderData;
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
      <h1 className="text-2xl font-bold text-white">Users</h1>

      <section className="rounded-xl border border-white/10 p-4 bg-white/[0.02]">
        <h2 className="text-white font-semibold text-base mb-3">Password reset</h2>
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
            Allow users to reset their password via email.
          </label>
          {!passwordResetEnabled && (
            <p className="text-xs text-white/55">
              Users will need to sign in via your SSO provider when that&apos;s
              configured.
            </p>
          )}
        </userFetcher.Form>
      </section>

      <section className="rounded-xl border border-white/10 p-4 bg-white/[0.02]">
        <h2 className="text-white font-semibold text-base mb-3">Viewer Privacy Access</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm text-white/70 font-medium">Reset Global 4-Digit PIN</h3>
            <userFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="action" value="setViewerPin" />
              <Input
                name="pin"
                required
                minLength={4}
                maxLength={32}
                placeholder="New access code..."
                value={viewerPin}
                onChange={(e) => setViewerPinState(e.target.value)}
              />
              <label className="inline-flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" name="revokeViewerSessions" value="on" />
                Revoke all current viewer sessions after resetting PIN
              </label>
              <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle" || viewerPin.trim().length < 4}>
                <KeyRound className="w-4 h-4" />
                Save PIN
              </Button>
            </userFetcher.Form>
            {fetcherData?.viewerPin ? (
              <p className="text-xs text-yellow-300">New PIN: {fetcherData.viewerPin}</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm text-white/70 font-medium">Create Viewer Magic Link</h3>
            <userFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="action" value="createViewerMagicLink" />
              <Input
                type="number"
                name="daysValid"
                min={1}
                max={30}
                value={daysValid}
                onChange={(e) => setDaysValid(e.target.value)}
                placeholder="Days valid (default 7)"
              />
              <p className="text-xs text-white/60">
                This link will be valid for {daysValid || "7"} day(s).
              </p>
              <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle"}>
                <LinkIcon className="w-4 h-4" />
                Generate Link
              </Button>
            </userFetcher.Form>
            {fetcherData?.magicLink ? (
              <p className="text-xs text-green-300 break-all">{fetcherData.magicLink}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm text-white/70 font-medium mb-2">Locked Viewer Clients</h3>
          {locks.length === 0 ? (
            <p className="text-sm text-white/50">No active lockouts.</p>
          ) : (
            <div className="space-y-2">
              {locks.map((lock: { clientKey: string; ipHint: string | null; requiresAdminReset: boolean; lockedUntil: string | Date | null }) => (
                <div key={lock.clientKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2">
                  <div className="text-sm text-white/80">
                    {lock.ipHint ?? "Unknown network"} - {lock.requiresAdminReset ? "Admin reset required" : `Locked until ${lock.lockedUntil ? new Date(lock.lockedUntil).toLocaleString() : "unknown"}`}
                  </div>
                  <userFetcher.Form method="post">
                    <input type="hidden" name="action" value="resetViewerLock" />
                    <input type="hidden" name="clientKey" value={lock.clientKey} />
                    <Button size="sm" variant="ghost" type="submit" isDisabled={userFetcher.state !== "idle"}>
                      <ShieldX className="w-3 h-3" />
                      Reset Lock
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
        <h2 className="text-white font-semibold text-base mb-3">Create User</h2>
        <userFetcher.Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="action" value="createUser" />
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">Full Name</label>
            <Input name="name" required className="w-44" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">Email</label>
            <Input type="email" name="email" required className="w-52" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-white/50">Role</label>
            <select
              name="role"
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white w-32 text-sm"
            >
              <option value="CONTROLLER">Controller</option>
              <option value="ADMIN">Admin</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <Button type="submit" variant="primary" isDisabled={userFetcher.state !== "idle"}>
            Create User
          </Button>
        </userFetcher.Form>
      </section>

      {/* Users table */}
      <section>
        <Table aria-label="Users">
          <TableContent>
            <TableHeader>
              <TableColumn isRowHeader>Name</TableColumn>
              <TableColumn>Email</TableColumn>
              <TableColumn>Role</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn>Actions</TableColumn>
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
                        <option value="VIEWER">Viewer</option>
                        <option value="CONTROLLER">Controller</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </userFetcher.Form>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                        Banned
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                        Active
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
                          Reset PW
                        </Button>
                      </userFetcher.Form>
                      <BanButton user={user} currentUserId={currentUserId} />
                      <userFetcher.Form method="post">
                        <input type="hidden" name="action" value="revokeUserSessions" />
                        <input type="hidden" name="userId" value={user.id} />
                        <Button size="sm" variant="ghost" type="submit" isDisabled={userFetcher.state !== "idle"}>
                          <ShieldX className="w-3 h-3" />
                          Revoke Sessions
                        </Button>
                      </userFetcher.Form>
                      <ImpersonateButton user={user} currentUserId={currentUserId} />
                      {user.id !== currentUserId && (
                        <userFetcher.Form method="post">
                          <input type="hidden" name="action" value="deleteUser" />
                          <input type="hidden" name="userId" value={user.id} />
                          <Button size="sm" variant="danger" type="submit" isDisabled={userFetcher.state !== "idle"}>
                            <Trash2 className="w-3 h-3" />
                            Delete
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
