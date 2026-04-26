import { data, Form, Link, useActionData } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/orgs.$orgId";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { buildUsageSnapshot, countOrgUsage } from "~/domain/billing/plan-usage.server";
import { setOrgComp, clearOrgComp, recordOrgAudit } from "~/domain/billing/comp.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getPublicEnv } from "~/domain/utils/host.server";
import { schoolBoardHostname, tenantBoardUrlFromRequest } from "~/lib/org-slug";
import type { UsageSnapshot } from "~/lib/plan-usage-types";
import {
  inviteUser,
  resendInvite,
  type InviteUserError,
} from "~/domain/admin-users/invite-user.server";
import { revokePendingInvites } from "~/domain/auth/user-invite.server";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.org ? `Platform — ${data.org.name}` : "Platform — Org" },
];

export async function loader({ context, params }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const me = getOptionalUserFromContext(context);
  const db = getPrisma(context);
  const env = getPublicEnv(context);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim();

  const org = await db.org.findUnique({
    where: { id: params.orgId },
  });
  if (!org) {
    throw new Response("Not found", { status: 404 });
  }

  // Load last 20 audit log entries (OrgAuditLog is a new model; use (db as any) until prisma generate runs)
  // TODO: remove `as any` after running `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate`
  let auditLogs: Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    payload: unknown;
    createdAt: Date | string;
    actorEmail?: string | null;
  }> = [];
  try {
    const rawLogs = await (db as any).orgAuditLog.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    // Enrich with actor email
    const actorIds = [...new Set(rawLogs.map((l: any) => l.actorUserId).filter(Boolean))] as string[];
    let actorMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const actors = await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      });
      actorMap = Object.fromEntries(actors.map((a) => [a.id, a.email]));
    }
    auditLogs = rawLogs.map((l: any) => ({
      ...l,
      actorEmail: l.actorUserId ? (actorMap[l.actorUserId] ?? null) : null,
    }));
  } catch {
    // OrgAuditLog table may not exist yet in this environment — safe to ignore
  }

  const [counts, users] = await Promise.all([
    countOrgUsage(db, org.id),
    db.user.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    }),
  ]);

  const usageSnapshot = buildUsageSnapshot(org, counts, new Date());
  const tenantHomeUrl = root ? `https://${org.slug}.${root}` : `https://${org.slug}.localhost`;

  return {
    org,
    usageSnapshot,
    users,
    auditLogs,
    tenantHomeUrl,
    publicRootDomain: root,
    currentUserId: me?.id ?? null,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await requirePlatformAdmin(context);
  const me = getOptionalUserFromContext(context);
  const db = getPrisma(context);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const orgId = params.orgId;

  // Verify org exists
  const org = await db.org.findUnique({ where: { id: orgId } });
  if (!org) throw new Response("Not found", { status: 404 });

  switch (intent) {
    case "set-comp": {
      const compedUntilRaw = String(formData.get("compedUntil") ?? "").trim();
      const billingNote = String(formData.get("billingNote") ?? "").trim() || null;
      if (!compedUntilRaw) {
        return data({ ok: false, error: "compedUntil is required" }, { status: 400 });
      }
      const compedUntil = new Date(compedUntilRaw);
      if (isNaN(compedUntil.getTime())) {
        return data({ ok: false, error: "Invalid date" }, { status: 400 });
      }
      await setOrgComp({
        context,
        orgId,
        compedUntil,
        billingNote,
        actorUserId: me?.id ?? null,
      });
      return data({ ok: true });
    }

    case "clear-comp": {
      await clearOrgComp({ context, orgId, actorUserId: me?.id ?? null });
      return data({ ok: true });
    }

    case "manual-plan": {
      const billingPlanRaw = String(formData.get("billingPlan") ?? "");
      const validPlans = [
        "FREE",
        "CAR_LINE",
        "CAMPUS",
        "DISTRICT",
        "ENTERPRISE",
      ] as const;
      type ValidPlan = (typeof validPlans)[number];
      if (!validPlans.includes(billingPlanRaw as ValidPlan)) {
        return data({ ok: false, error: "Invalid plan" }, { status: 400 });
      }
      const billingPlan = billingPlanRaw as ValidPlan;
      const fromPlan = org.billingPlan;
      await db.org.update({
        where: { id: orgId },
        data: { billingPlan },
      });
      await recordOrgAudit({
        context,
        orgId,
        actorUserId: me?.id ?? null,
        action: "plan.manual_change",
        payload: { from: fromPlan, to: billingPlan },
      });
      return data({ ok: true });
    }

    case "extend-trial": {
      const daysRaw = Number(formData.get("days") ?? "0");
      const days = Math.floor(daysRaw);
      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        return data(
          { ok: false, error: "Enter a positive number of days (≤ 365)." },
          { status: 400 },
        );
      }
      const base = org.trialEndsAt ? new Date(org.trialEndsAt) : new Date();
      const newEnd = new Date(base.getTime() + days * 86_400_000);
      const patch: Record<string, unknown> = { trialEndsAt: newEnd };
      // If the org was already suspended after trial end, put it back into
      // TRIALING so the extension actually restores access.
      if (org.status === "SUSPENDED" || org.status === "INCOMPLETE") {
        patch.status = "TRIALING";
      }
      await db.org.update({ where: { id: orgId }, data: patch });
      await recordOrgAudit({
        context,
        orgId,
        actorUserId: me?.id ?? null,
        action: "trial.extend",
        payload: {
          days,
          from: org.trialEndsAt?.toISOString() ?? null,
          to: newEnd.toISOString(),
          statusRestored: patch.status === "TRIALING",
        },
      });
      return data({ ok: true });
    }

    case "toggle-comped": {
      // Flip the persistent `isComped` flag. If turning on, also flip status
      // to ACTIVE so the org has full access immediately. If turning off and
      // the trial has expired, drop them back into SUSPENDED.
      const currentIsComped = !!(org as any).isComped;
      const nextIsComped = !currentIsComped;
      const patch: Record<string, unknown> = { isComped: nextIsComped };
      if (nextIsComped) {
        patch.status = "ACTIVE";
      } else {
        const trialExpired =
          org.trialEndsAt && new Date(org.trialEndsAt).getTime() <= Date.now();
        if (trialExpired && org.status !== "ACTIVE") {
          patch.status = "SUSPENDED";
        }
      }
      await db.org.update({ where: { id: orgId }, data: patch });
      await recordOrgAudit({
        context,
        orgId,
        actorUserId: me?.id ?? null,
        action: nextIsComped ? "comp.toggle_on" : "comp.toggle_off",
        payload: { statusAfter: patch.status ?? org.status },
      });
      return data({ ok: true });
    }

    case "invite-user": {
      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      const name = String(formData.get("name") ?? "").trim();
      const role = String(formData.get("role") ?? "");
      const result = await inviteUser(context, {
        request,
        email,
        name,
        scope: { kind: "org", id: orgId },
        role,
        invitedByUserId: me?.id ?? null,
        invitedByEmail: (me as { email?: string } | null)?.email ?? null,
        invitedToLabel: org.name,
      });
      if (!result.ok) {
        return data(
          { ok: false, error: inviteErrorMessage(result.error) },
          { status: 400 },
        );
      }
      return data({ ok: true });
    }

    case "resend-invite": {
      const userId = String(formData.get("userId") ?? "");
      if (!userId) {
        return data({ ok: false, error: "Missing user." }, { status: 400 });
      }
      const result = await resendInvite(context, {
        request,
        userId,
        invitedByUserId: me?.id ?? null,
        invitedToLabel: org.name,
      });
      if (!result.ok) {
        const msg =
          result.error === "user-not-found"
            ? "User not found."
            : "User has already accepted their invite.";
        return data({ ok: false, error: msg }, { status: 400 });
      }
      return data({ ok: true });
    }

    case "revoke-invite": {
      const userId = String(formData.get("userId") ?? "");
      if (!userId) {
        return data({ ok: false, error: "Missing user." }, { status: 400 });
      }
      await revokePendingInvites(context, userId);
      return data({ ok: true });
    }

    case "impersonate": {
      const userId = String(formData.get("userId") ?? "").trim();
      if (!userId) {
        return data({ ok: false, error: "userId required" }, { status: 400 });
      }

      // Use better-auth server-side impersonation API.
      // auth.api.impersonateUser with asResponse: true returns a full Response
      // with Set-Cookie headers we can forward.
      const auth = getAuth(context);

      // Land admin/controller targets directly on /admin — that's the
      // debug surface the impersonator is here for. Other roles go to
      // the public board (landing on /admin would 403 the loader).
      const targetUser = await db.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      const tenantPath =
        targetUser?.role === "ADMIN" || targetUser?.role === "CONTROLLER"
          ? "/admin"
          : "/";
      const requestUrl = new URL(request.url);
      const boardHost = schoolBoardHostname(requestUrl.hostname, org.slug);
      const origin = requestUrl.port
        ? `${requestUrl.protocol}//${boardHost}:${requestUrl.port}`
        : `${requestUrl.protocol}//${boardHost}`;
      const tenantHomeUrl = `${origin}${tenantPath}`;

      let impersonateResponse: Response;
      try {
        impersonateResponse = await auth.api.impersonateUser({
          body: { userId },
          headers: request.headers,
          asResponse: true,
        }) as Response;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Impersonation failed";
        return data({ ok: false, error: msg }, { status: 400 });
      }

      // Write audit log
      try {
        await recordOrgAudit({
          context,
          orgId,
          actorUserId: me?.id ?? null,
          action: "impersonate.start",
          payload: { targetUserId: userId },
        });
      } catch {
        // Audit failure should not block impersonation
      }

      // Forward the Set-Cookie headers from the auth response, then redirect.
      // Headers#get("set-cookie") joins multiple cookies with ", " which
      // corrupts any cookie value containing a comma (e.g. dates) — use
      // getSetCookie() to preserve each cookie as its own header.
      const headers = new Headers();
      for (const cookie of impersonateResponse.headers.getSetCookie()) {
        headers.append("set-cookie", cookie);
      }
      headers.set("location", tenantHomeUrl);
      return new Response(null, { status: 302, headers });
    }

    default:
      return data({ ok: false, error: "Unknown intent" }, { status: 400 });
  }
}

function formatDt(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function inviteErrorMessage(error: InviteUserError): string {
  switch (error) {
    case "invalid-email":
      return "Enter a valid email address.";
    case "invalid-name":
      return "Name is required.";
    case "user-exists":
      return "A user with that email already exists.";
    case "invalid-scope-role":
      return "Invalid role for an org user.";
    case "create-failed":
    default:
      return "Could not create the user.";
  }
}

/** Convert a Date to a value suitable for datetime-local inputs (local time, no seconds). */
function toLocalDatetime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(x.getTime())) return "";
  // datetime-local format: YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function UsageBlock({ snapshot }: { snapshot: UsageSnapshot }) {
  const { counts, limits, worstLevel } = snapshot;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Usage</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-white/50">Students</dt>
          <dd>
            {counts.students}
            {limits ? ` / ${limits.students}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-white/50">Families</dt>
          <dd>
            {counts.families}
            {limits ? ` / ${limits.families}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-white/50">Classrooms</dt>
          <dd>
            {counts.classrooms}
            {limits ? ` / ${limits.classrooms}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-white/50">Level</dt>
          <dd className="capitalize">{worstLevel.replace(/_/g, " ")}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function PlatformOrgDetail({
  loaderData,
}: Route.ComponentProps) {
  const { org, usageSnapshot, users, auditLogs, tenantHomeUrl, publicRootDomain, currentUserId } = loaderData;
  const actionData = useActionData<typeof action>() as
    | { ok: true }
    | { ok: false; error: string }
    | undefined;
  const stripeCustomerUrl = org.stripeCustomerId
    ? `https://dashboard.stripe.com/customers/${org.stripeCustomerId}`
    : null;
  const actionError =
    actionData && actionData.ok === false ? actionData.error : null;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/platform" className="text-sm text-[#E9D500] hover:underline">
          ← All orgs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{org.name}</h1>
        <p className="mt-1 font-mono text-sm text-white/60">{org.slug}</p>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {actionError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
            Tenant
          </h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-white/50">URL</dt>
              <dd>
                <a
                  href={tenantHomeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#E9D500] underline hover:text-[#f5e047]"
                >
                  {tenantHomeUrl}
                </a>
              </dd>
            </div>
            {org.customDomain ? (
              <div>
                <dt className="text-white/50">Custom domain</dt>
                <dd>{org.customDomain}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-white/50">PUBLIC_ROOT_DOMAIN</dt>
              <dd className="font-mono text-xs text-white/70">{publicRootDomain || "(empty → slug.localhost)"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
            Billing
          </h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-white/50">Org status</dt>
              <dd>{org.status}</dd>
            </div>
            <div>
              <dt className="text-white/50">Plan</dt>
              <dd>{org.billingPlan}</dd>
            </div>
            <div>
              <dt className="text-white/50">Subscription status</dt>
              <dd>{org.subscriptionStatus ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Past due since</dt>
              <dd>{org.pastDueSinceAt ? formatDt(org.pastDueSinceAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Hard comp</dt>
              <dd className={(org as any).isComped ? "text-emerald-400" : "text-white/70"}>
                {(org as any).isComped ? "On (billing bypassed)" : "Off"}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Comped until</dt>
              <dd>{org.compedUntil ? formatDt(org.compedUntil) : "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Billing note</dt>
              <dd className="whitespace-pre-wrap text-white/80">{org.billingNote?.trim() || "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Stripe subscription</dt>
              <dd className="font-mono text-xs">{org.stripeSubscriptionId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Stripe customer</dt>
              <dd>
                {stripeCustomerUrl ? (
                  <a
                    href={stripeCustomerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    Open in Stripe
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Comp panel */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Comp</h2>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="set-comp" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-white/50" htmlFor="compedUntil">Comped until (local time)</label>
              <input
                id="compedUntil"
                type="datetime-local"
                name="compedUntil"
                defaultValue={toLocalDatetime(org.compedUntil)}
                className="app-field w-full"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-white/50" htmlFor="billingNote">Billing note</label>
              <textarea
                id="billingNote"
                name="billingNote"
                defaultValue={org.billingNote ?? ""}
                rows={3}
                className="app-field w-full resize-none"
                placeholder="Optional internal note"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-xs font-semibold text-[#193B4B] hover:bg-[#f5e047]"
              >
                Save comp
              </button>
            </div>
          </Form>
          {org.compedUntil && (
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="clear-comp" />
              <button
                type="submit"
                className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
              >
                Clear comp
              </button>
            </Form>
          )}
        </div>

        {/* Manual plan override panel */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Manual plan override</h2>
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="manual-plan" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-white/50" htmlFor="billingPlan">Billing plan</label>
              <select
                id="billingPlan"
                name="billingPlan"
                defaultValue={org.billingPlan ?? "FREE"}
                className="app-field w-full"
              >
                <option value="FREE">FREE</option>
                <option value="CAR_LINE">CAR_LINE</option>
                <option value="CAMPUS">CAMPUS</option>
                <option value="DISTRICT">DISTRICT</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </div>
            <button
              type="submit"
              className="self-start rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              Set plan
            </button>
          </Form>
        </div>
      </div>

      {/* Extend trial + Toggle comped */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
            Extend trial
          </h2>
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="extend-trial" />
            <label htmlFor="days" className="text-xs text-white/50">Extend by (days)</label>
            <input
              id="days"
              name="days"
              type="number"
              min={1}
              max={365}
              defaultValue={14}
              className="app-field w-full"
            />
            <button
              type="submit"
              className="self-start rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              Extend
            </button>
            <p className="text-xs text-white/40">
              If the org is currently SUSPENDED or INCOMPLETE after trial end,
              this also flips status back to TRIALING.
            </p>
          </Form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
            Hard comp (bypass billing)
          </h2>
          <p className="text-sm text-white/70">
            This org is currently{" "}
            <strong className={(org as any).isComped ? "text-emerald-400" : "text-white"}>
              {(org as any).isComped ? "COMPED" : "not comped"}
            </strong>
            .
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="toggle-comped" />
            <button
              type="submit"
              className={
                (org as any).isComped
                  ? "rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                  : "rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30"
              }
            >
              {(org as any).isComped ? "Turn comp OFF" : "Turn comp ON"}
            </button>
          </Form>
          <p className="mt-3 text-xs text-white/40">
            Comped orgs skip the &quot;Billing Action Required&quot; gate
            regardless of subscription / trial status. Turning comp off when
            the trial has expired drops them back to SUSPENDED.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Trial</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-white/50">Started</dt>
              <dd>{org.trialStartedAt ? formatDt(org.trialStartedAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Ends</dt>
              <dd>{org.trialEndsAt ? formatDt(org.trialEndsAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-white/50">Qualifying pickup days</dt>
              <dd>{org.trialQualifyingPickupDays}</dd>
            </div>
          </dl>
        </div>
        <UsageBlock snapshot={usageSnapshot} />
      </div>

      {/* Invite a user to this org */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          Invite user to this org
        </h2>
        <p className="mb-3 text-xs text-white/55">
          They&rsquo;ll get an email with a link to set their password and sign
          in. Invite expires after 7 days.
        </p>
        <Form
          method="post"
          className="grid max-w-3xl gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
        >
          <input type="hidden" name="intent" value="invite-user" />
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-white/50" htmlFor="invite-role">
              Role
            </label>
            <select
              id="invite-role"
              name="role"
              defaultValue="CONTROLLER"
              className="app-field"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="CONTROLLER">CONTROLLER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#E9D500] px-3 py-2 text-xs font-semibold text-[#193B4B] hover:brightness-95"
          >
            Send invite
          </button>
        </Form>
      </div>

      {/* Users table with impersonation + invite controls */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Users</h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold"> </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono text-[10px] text-white/50">{u.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">
                    {u.mustChangePassword ? (
                      <span className="inline-flex items-center rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-300">
                        Invite pending
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-300">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-white/70">{formatDt(u.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {u.mustChangePassword ? (
                        <>
                          <Form method="post">
                            <input type="hidden" name="intent" value="resend-invite" />
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/5"
                            >
                              Resend
                            </button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="revoke-invite" />
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10"
                            >
                              Revoke
                            </button>
                          </Form>
                        </>
                      ) : null}
                      {currentUserId && u.id !== currentUserId ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="impersonate" />
                          <input type="hidden" name="userId" value={u.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-[#E9D500]/40 bg-[#E9D500]/10 px-2 py-1 text-xs font-medium text-[#E9D500] hover:bg-[#E9D500]/20"
                          >
                            Impersonate
                          </button>
                        </Form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit log panel */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">
          Recent audit log
        </h2>
        {auditLogs.length === 0 ? (
          <p className="text-sm text-white/40">No audit entries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-white/5 text-white/80">
                <tr>
                  <th className="px-3 py-2 font-semibold">Timestamp</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Payload</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-t border-white/10">
                    <td className="px-3 py-2 text-xs text-white/60 whitespace-nowrap">
                      {formatDt(log.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-white/70">
                      {log.actorEmail ?? log.actorUserId ?? "system"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-white/50 max-w-xs truncate">
                      {log.payload ? JSON.stringify(log.payload) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
