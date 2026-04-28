import { data, Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/orgs.new";
import { getPrisma } from "~/db.server";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { recordOrgAudit } from "~/domain/billing/comp.server";
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";
import { slugifyOrgName } from "~/lib/org-slug";

const VALID_PLANS = [
  "FREE",
  "CAR_LINE",
  "CAMPUS",
  "DISTRICT",
  "ENTERPRISE",
] as const;
type Plan = (typeof VALID_PLANS)[number];

export const meta: Route.MetaFunction = () => [
  { title: "Platform — Create comped org" },
];

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  await requirePlatformAdmin(context);
  const me = getOptionalUserFromContext(context);
  const actor = getActorIdsFromContext(context);
  const db = getPrisma(context);
  const form = await request.formData();

  const orgName = String(form.get("orgName") ?? "").trim();
  const slugRaw = String(form.get("slug") ?? "").trim();
  const adminEmail = String(form.get("adminEmail") ?? "").trim().toLowerCase();
  const planRaw = String(form.get("plan") ?? "FREE");
  const plan = (VALID_PLANS as readonly string[]).includes(planRaw)
    ? (planRaw as Plan)
    : "FREE";

  if (orgName.length < 2) {
    return data({ error: "Org name must be at least 2 characters." }, { status: 400 });
  }
  const slug = slugifyOrgName(slugRaw);
  if (!slug) {
    return data({ error: "Slug is required (lowercase letters, numbers, hyphens)." }, { status: 400 });
  }
  if (!adminEmail || !adminEmail.includes("@")) {
    return data({ error: "A valid admin email is required." }, { status: 400 });
  }

  const existingSlug = await db.org.findUnique({ where: { slug } });
  if (existingSlug) {
    return data({ error: `Slug "${slug}" is already taken.` }, { status: 400 });
  }

  // Create comped org. Status goes straight to ACTIVE; isComped = true to
  // bypass billing enforcement entirely. No trial window is set.
  const org = await db.org.create({
    data: {
      name: orgName,
      slug,
      billingPlan: plan,
      status: "ACTIVE",
      // Cast via `as any` because the generated Prisma client type hasn't
      // been regenerated against the updated schema yet.
      ...({ isComped: true } as any),
    },
  });

  // Find-or-create the admin user. If the email already belongs to a user in
  // another org, we error out — the staff operator must pick a different
  // email rather than silently yank someone's org membership.
  const existingUser = await db.user.findUnique({ where: { email: adminEmail } });
  if (existingUser && existingUser.orgId && existingUser.orgId !== org.id) {
    // Roll back the org create to keep this operation atomic.
    await db.org.delete({ where: { id: org.id } });
    return data(
      {
        error: `User ${adminEmail} already belongs to another org. Pick a different admin email or transfer them from their current org first.`,
      },
      { status: 400 },
    );
  }

  if (existingUser) {
    await db.user.update({
      where: { id: existingUser.id },
      data: { orgId: org.id, role: "ADMIN" },
    });
  } else {
    // Create a user shell. Password is unset — the admin will use the
    // "forgot password" flow (mustChangePassword triggers a reset on next
    // login). better-auth's Account row is not created here; the reset-flow
    // will set a password hash the first time they claim it.
    await db.user.create({
      data: {
        email: adminEmail,
        name: "",
        role: "ADMIN",
        orgId: org.id,
        mustChangePassword: true,
      },
    });
  }

  try {
    await recordOrgAudit({
      context,
      orgId: org.id,
      actorUserId: actor.actorUserId ?? me?.id ?? null,
      onBehalfOfUserId: actor.onBehalfOfUserId,
      action: "org.comp_created",
      payload: { plan, adminEmail },
    });
  } catch {
    // non-fatal
  }

  throw redirect(`/platform/orgs/${org.id}`);
}

export default function NewCompedOrg() {
  const actionData = useActionData<typeof action>();
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link to="/platform" className="text-sm text-[#E9D500] hover:underline">
          ← All orgs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Create comped org</h1>
        <p className="mt-1 text-sm text-white/60">
          Provision a brand-new org with billing bypass turned on. Use this for
          comps, internal test orgs, or pilots Noah is personally supporting.
        </p>
      </div>

      <Form method="post" className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="orgName" className="text-xs text-white/50">Org name</label>
          <input
            id="orgName"
            name="orgName"
            type="text"
            required
            minLength={2}
            className="app-field"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="slug" className="text-xs text-white/50">Slug (lowercase, numbers, hyphens)</label>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="[a-z0-9-]+"
            className="app-field"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="adminEmail" className="text-xs text-white/50">Admin email</label>
          <input
            id="adminEmail"
            name="adminEmail"
            type="email"
            required
            className="app-field"
          />
          <p className="text-xs text-white/40">
            If this email is already a user, they&apos;ll be attached to the
            new org as ADMIN (as long as they aren&apos;t in another org).
            Otherwise a new user shell is created and they&apos;ll set a
            password via the &quot;forgot password&quot; flow.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan" className="text-xs text-white/50">Plan tier</label>
          <select
            id="plan"
            name="plan"
            defaultValue="FREE"
            className="app-field"
          >
            {VALID_PLANS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <p className="text-xs text-white/40">
            Comped orgs bypass billing regardless of plan; plan is cosmetic
            here and used for plan-limit calculations.
          </p>
        </div>
        {actionData?.error && (
          <p className="text-sm text-red-400">{actionData.error}</p>
        )}
        <button
          type="submit"
          className="rounded-lg bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:bg-[#f5e047]"
        >
          Create comped org
        </button>
      </Form>
    </div>
  );
}
