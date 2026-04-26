import { Form, Link } from "react-router";
import { getPrisma } from "~/db.server";
import type { Route } from "./+types/index";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPublicEnv } from "~/domain/utils/host.server";

const BILLING_PLANS = [
  "FREE",
  "STARTER",
  "CAR_LINE",
  "CAMPUS",
  "DISTRICT",
  "ENTERPRISE",
] as const;
const ORG_STATUSES = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "SUSPENDED",
  "INCOMPLETE",
  "CANCELED",
] as const;

const PAGE_SIZE = 50;

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const db = getPrisma(context);
  const env = getPublicEnv(context);
  const root = (env.PUBLIC_ROOT_DOMAIN ?? "").trim();

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const plan = url.searchParams.get("plan") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const take = Math.min(200, Math.max(1, parseInt(url.searchParams.get("take") ?? String(PAGE_SIZE), 10) || PAGE_SIZE));

  // Build where filters
  const where: Record<string, unknown> = {};
  if (status && ORG_STATUSES.includes(status as (typeof ORG_STATUSES)[number])) {
    where.status = status;
  }
  if (plan && BILLING_PLANS.includes(plan as (typeof BILLING_PLANS)[number])) {
    where.billingPlan = plan;
  }
  if (search.trim()) {
    where.OR = [
      { name: { contains: search.trim() } },
      { slug: { contains: search.trim() } },
    ];
  }

  const [rawOrgs, total] = await Promise.all([
    db.org.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      skip: (page - 1) * take,
    }),
    db.org.count({ where }),
  ]);

  // Enrich with user counts in a single grouped query (cheaper than N+1).
  const orgIds = rawOrgs.map((o) => o.id);
  const userCounts = orgIds.length
    ? await db.user.groupBy({
        by: ["orgId"],
        where: { orgId: { in: orgIds } },
        _count: { _all: true },
      })
    : [];
  const countByOrg = new Map<string, number>(
    userCounts
      .filter((r): r is typeof r & { orgId: string } => !!r.orgId)
      .map((r) => [r.orgId, r._count._all]),
  );
  const orgs = rawOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    billingPlan: o.billingPlan,
    customDomain: o.customDomain,
    trialEndsAt: o.trialEndsAt,
    trialQualifyingPickupDays: o.trialQualifyingPickupDays,
    compedUntil: o.compedUntil,
    isComped: (o as any).isComped ?? false,
    createdAt: o.createdAt,
    userCount: countByOrg.get(o.id) ?? 0,
  }));

  const totalPages = Math.ceil(total / take);
  return { orgs, publicRootDomain: root, page, totalPages, total, search, status, plan, take };
}

export default function PlatformIndex({ loaderData }: Route.ComponentProps) {
  const { orgs, publicRootDomain, page, totalPages, total, search, status, plan, take } = loaderData;
  const now = new Date();

  const tenantUrl = (slug: string) => {
    if (!publicRootDomain) {
      return `https://${slug}.localhost`;
    }
    return `https://${slug}.${publicRootDomain}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-white/70">
          Search-friendly list of organizations. Open a school in a new tab using its tenant URL.
        </p>
        <Link
          to="/platform/orgs/new"
          className="rounded-lg bg-[#E9D500] px-3 py-2 text-xs font-semibold text-[#193B4B] hover:bg-[#f5e047]"
        >
          + New comped org
        </Link>
      </div>

      {/* Filter form — GET so URL is the state */}
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Search</span>
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Name or slug"
            className="min-w-[200px] app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-white/60">Billing plan</span>
          <select
            name="plan"
            defaultValue={plan}
            className="app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
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
            name="status"
            defaultValue={status}
            className="app-field focus:border-[#E9D500]/50 focus:outline-none focus:ring-1 focus:ring-[#E9D500]/40"
          >
            <option value="">All</option>
            {ORG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="page" value="1" />
        <button
          type="submit"
          className="rounded-lg bg-[#E9D500]/20 px-4 py-2 text-sm font-medium text-[#E9D500] hover:bg-[#E9D500]/30"
        >
          Filter
        </button>
        <a
          href="/platform"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 hover:text-white"
        >
          Reset
        </a>
      </Form>

      <p className="text-xs text-white/40">
        {total} org{total !== 1 ? "s" : ""} matching filters
        {totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}
      </p>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Slug</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Users</th>
              <th className="px-3 py-2 font-semibold">Trial ends</th>
              <th className="px-3 py-2 font-semibold">Created</th>
              <th className="px-3 py-2 font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => {
              const compedTimed = !!org.compedUntil && new Date(org.compedUntil) > now;
              const compedHardOn = !!org.isComped;
              return (
                <tr key={org.id} className="border-t border-white/10">
                  <td className="px-3 py-2">
                    <Link
                      to={`/platform/orgs/${org.id}`}
                      className="font-medium text-[#E9D500] underline hover:text-[#f5e047]"
                    >
                      {org.name}
                    </Link>
                    {(compedTimed || compedHardOn) && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-400">
                        {compedHardOn ? "Comped" : "Temp comp"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-white/80">{org.slug}</td>
                  <td className="px-3 py-2 text-white/80">{org.billingPlan}</td>
                  <td className="px-3 py-2">{org.status}</td>
                  <td className="px-3 py-2 text-white/70">{org.userCount}</td>
                  <td className="px-3 py-2 text-white/70">
                    {org.trialEndsAt
                      ? new Date(org.trialEndsAt).toISOString().slice(0, 10)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-white/70">
                    {new Date(org.createdAt).toISOString().slice(0, 10)}
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && (
            <a
              href={`/platform?${new URLSearchParams({ search, status, plan, page: String(page - 1), take: String(take) }).toString()}`}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/5"
            >
              Previous
            </a>
          )}
          <span className="text-white/50">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/platform?${new URLSearchParams({ search, status, plan, page: String(page + 1), take: String(take) }).toString()}`}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-white/70 hover:bg-white/5"
            >
              Next
            </a>
          )}
        </div>
      )}
    </div>
  );
}
