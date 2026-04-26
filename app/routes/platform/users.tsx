import { data, Form, redirect } from "react-router";
import type { Route } from "./+types/users";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import {
  inviteUser,
  resendInvite,
  type InviteUserError,
} from "~/domain/admin-users/invite-user.server";
import { revokePendingInvites } from "~/domain/auth/user-invite.server";

export const meta: Route.MetaFunction = () => [{ title: "Platform — Users" }];

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context) as any;

  const platformAdmins = await db.user.findMany({
    where: { role: "PLATFORM_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });

  // Pending invites for any platform admin shell that hasn't accepted.
  const pendingByUser = await db.userInviteToken.findMany({
    where: {
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { role: "PLATFORM_ADMIN" },
    },
    orderBy: { createdAt: "desc" },
    select: { userId: true, expiresAt: true, createdAt: true },
  });

  const pendingMap = new Map<
    string,
    { expiresAt: Date; createdAt: Date }
  >();
  for (const p of pendingByUser as Array<{
    userId: string;
    expiresAt: Date;
    createdAt: Date;
  }>) {
    if (!pendingMap.has(p.userId)) pendingMap.set(p.userId, p);
  }

  type AdminRow = {
    id: string;
    email: string;
    name: string;
    mustChangePassword: boolean;
    createdAt: Date;
  };
  const admins = (platformAdmins as AdminRow[]).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    pending: u.mustChangePassword,
    inviteExpiresAt: pendingMap.get(u.id)?.expiresAt ?? null,
    createdAt: u.createdAt,
  }));

  return { admins };
}

export async function action({ request, context }: Route.ActionArgs) {
  await requirePlatformAdmin(context);
  const me = getOptionalUserFromContext(context);
  if (!me) throw new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "invite") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim();
    const result = await inviteUser(context, {
      request,
      email,
      name,
      scope: { kind: "platform" },
      role: "PLATFORM_ADMIN",
      invitedByUserId: me.id,
      invitedByEmail: (me as { email?: string }).email ?? null,
      invitedToLabel: null,
    });
    if (!result.ok) {
      return data({ error: errorMessage(result.error) }, { status: 400 });
    }
    throw redirect("/platform/users");
  }

  if (intent === "resend") {
    const userId = String(form.get("userId") ?? "");
    if (!userId) return data({ error: "Missing user." }, { status: 400 });
    const result = await resendInvite(context, {
      request,
      userId,
      invitedByUserId: me.id,
      invitedToLabel: null,
    });
    if (!result.ok) {
      const msg =
        result.error === "user-not-found"
          ? "User not found."
          : "That user has already accepted their invite.";
      return data({ error: msg }, { status: 400 });
    }
    throw redirect("/platform/users");
  }

  if (intent === "revoke") {
    const userId = String(form.get("userId") ?? "");
    if (!userId) return data({ error: "Missing user." }, { status: 400 });
    await revokePendingInvites(context, userId);
    throw redirect("/platform/users");
  }

  return data({ error: "Unknown action." }, { status: 400 });
}

function errorMessage(error: InviteUserError): string {
  switch (error) {
    case "invalid-email":
      return "Enter a valid email address.";
    case "invalid-name":
      return "Name is required.";
    case "user-exists":
      return "A user with that email already exists.";
    case "invalid-scope-role":
      return "That role isn't allowed for platform staff.";
    case "create-failed":
    default:
      return "Could not create the user.";
  }
}

function formatDt(d: Date | string | null) {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export default function PlatformUsers({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { admins } = loaderData;
  const error = (actionData as { error?: string } | undefined)?.error;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Platform staff</h1>
        <p className="mt-1 text-sm text-white/60">
          Tome employees who can access this internal panel. Invitees get an
          email with a magic link to set their password and sign in.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          Invite a platform admin
        </h2>
        <Form method="post" className="grid max-w-xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="intent" value="invite" />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50" htmlFor="invite-name">
              Name
            </label>
            <input
              id="invite-name"
              name="name"
              required
              className="app-field"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50" htmlFor="invite-email">
              Email
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              className="app-field"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#E9D500] px-3 py-2 text-xs font-semibold text-[#193B4B] hover:brightness-95"
          >
            Send invite
          </button>
        </Form>
        {error ? (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          Staff
        </h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold"> </th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-medium">{a.name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.email}</td>
                  <td className="px-3 py-2">
                    {a.pending ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-300">
                        Invite pending
                        {a.inviteExpiresAt ? (
                          <span className="text-yellow-300/60">
                            (expires {formatDt(a.inviteExpiresAt)})
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-300">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-white/70">
                    {formatDt(a.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {a.pending ? (
                      <div className="flex justify-end gap-2">
                        <Form method="post">
                          <input type="hidden" name="intent" value="resend" />
                          <input type="hidden" name="userId" value={a.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/5"
                          >
                            Resend invite
                          </button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="revoke" />
                          <input type="hidden" name="userId" value={a.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10"
                          >
                            Revoke
                          </button>
                        </Form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
