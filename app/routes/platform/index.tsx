import { useMemo, useState } from "react";
import { Link } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/index";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPublicEnv } from "~/domain/utils/host.server";

const BILLING_PLANS = ["FREE", "STARTER", "CAR_LINE", "CAMPUS", "ENTERPRISE"] as const;
const ORG_STATUSES = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "SUSPENDED",
  "INCOMPLETE",
  "CANCELED",
] as const;

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const env = getPublicEnv(context);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim();
  const orgs = await db.org.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      billingPlan: true,
      customDomain: true,
      trialEndsAt: true,
      trialQualifyingPickupDays: true,
      createdAt: true,
    },
  });
  return { orgs, publicRootDomain: root };
}

export default function PlatformIndex({ loaderData }: Route.ComponentProps) {
  const { orgs, publicRootDomain } = loaderData;
  const [q, setQ] = useState("");
  const [billingPlan, setBillingPlan] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const tenantUrl = (slug: string) => {
    if (!publicRootDomain) {
      return `https://${slug}.localhost`;
    }
    return `https://${slug}.${publicRootDomain}`;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orgs.filter((org) => {
      if (billingPlan && org.billingPlan !== billingPlan) return false;
      if (status && org.status !== status) return false;
      if (!needle) return true;
      return (
        org.name.toLowerCase().includes(needle) || org.slug.toLowerCase().includes(needle)
      );
    });
  }, [orgs, q, billingPlan, status]);

  return (
    <div className="space-y-6">
      <p className="text-white/70">
        Search-friendly list of organizations. Open a school in a new tab using its tenant URL.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or slug"
            className="min-w-[200px] rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Billing plan</span>
          <select
            value={billingPlan}
            onChange={(e) => setBillingPlan(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#0f1414] px-3 py-2 text-white focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          >
            <option value="">All</option>
            {BILLING_PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#0f1414] px-3 py-2 text-white focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          >
            <option value="">All</option>
            {ORG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Slug</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Trial</th>
              <th className="px-3 py-2 font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((org) => (
              <tr key={org.id} className="border-t border-white/10">
                <td className="px-3 py-2">
                  <Link
                    to={`/platform/orgs/${org.id}`}
                    className="font-medium text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    {org.name}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">{org.slug}</td>
                <td className="px-3 py-2 text-white/80">{org.billingPlan}</td>
                <td className="px-3 py-2">{org.status}</td>
                <td className="px-3 py-2 text-white/70">
                  {org.trialEndsAt
                    ? `${org.trialQualifyingPickupDays} qualifying days · ends ${org.trialEndsAt.toISOString().slice(0, 10)}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <a
                    href={tenantUrl(org.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E9D500] underline hover:text-[#f5e047]"
                  >
                    Tenant site
                  </a>
                  {org.customDomain ? (
                    <div className="mt-1 text-xs text-white/50">{org.customDomain}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
