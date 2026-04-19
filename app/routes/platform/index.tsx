import { getPrisma } from "~/db.server";
import type { Route } from "./+types/index";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getPublicEnv } from "~/domain/utils/host.server";

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

  const tenantUrl = (slug: string) => {
    if (!publicRootDomain) {
      return `https://${slug}.localhost`;
    }
    return `https://${slug}.${publicRootDomain}`;
  };

  return (
    <div className="space-y-6">
      <p className="text-white/70">
        Search-friendly list of organizations. Open a school in a new tab using its tenant URL.
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Slug</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Trial</th>
              <th className="px-3 py-2 font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} className="border-t border-white/10">
                <td className="px-3 py-2">{org.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-white/80">{org.slug}</td>
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
