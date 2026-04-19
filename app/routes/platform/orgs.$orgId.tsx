import { useState } from "react";
import { Link } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/orgs.$orgId";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { buildUsageSnapshot, countOrgUsage } from "~/domain/billing/plan-usage.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { getPublicEnv } from "~/domain/utils/host.server";
import { authClient } from "~/lib/auth-client";
import type { UsageSnapshot } from "~/lib/plan-usage-types";

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

  const [counts, users] = await Promise.all([
    countOrgUsage(db, org.id),
    db.user.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, role: true, createdAt: true },
    }),
  ]);

  const usageSnapshot = buildUsageSnapshot(org, counts, new Date());
  const tenantHomeUrl = root ? `https://${org.slug}.${root}` : `https://${org.slug}.localhost`;

  return {
    org,
    usageSnapshot,
    users,
    tenantHomeUrl,
    publicRootDomain: root,
    currentUserId: me?.id ?? null,
  };
}

function formatDt(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().replace("T", " ").slice(0, 19) + "Z";
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

function ImpersonateButton({
  userId,
  currentUserId,
  tenantHomeUrl,
}: {
  userId: string;
  currentUserId: string | null;
  tenantHomeUrl: string;
}) {
  const [loading, setLoading] = useState(false);
  if (!currentUserId || userId === currentUserId) return null;

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        const { error } = await authClient.admin.impersonateUser({ userId });
        if (error) {
          setLoading(false);
          return;
        }
        window.location.href = tenantHomeUrl;
      }}
      className="rounded-md border border-[#E9D500]/40 bg-[#E9D500]/10 px-2 py-1 text-xs font-medium text-[#E9D500] hover:bg-[#E9D500]/20 disabled:opacity-50"
    >
      {loading ? "…" : "Impersonate"}
    </button>
  );
}

export default function PlatformOrgDetail({ loaderData }: Route.ComponentProps) {
  const { org, usageSnapshot, users, tenantHomeUrl, publicRootDomain, currentUserId } = loaderData;
  const stripeCustomerUrl = org.stripeCustomerId
    ? `https://dashboard.stripe.com/customers/${org.stripeCustomerId}`
    : null;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/platform" className="text-sm text-[#E9D500] hover:underline">
          ← All orgs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{org.name}</h1>
        <p className="mt-1 font-mono text-sm text-white/60">{org.slug}</p>
      </div>

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

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#E9D500]">Users</h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Role</th>
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
                  <td className="px-3 py-2 text-white/70">{formatDt(u.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <ImpersonateButton
                      userId={u.id}
                      currentUserId={currentUserId}
                      tenantHomeUrl={tenantHomeUrl}
                    />
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
