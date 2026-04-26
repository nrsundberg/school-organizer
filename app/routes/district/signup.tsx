import { Button, Input } from "@heroui/react";
import { data, Form, redirect } from "react-router";
import type { Route } from "./+types/signup";
import { createDistrict } from "~/domain/district/district.server";
import { writeDistrictAudit } from "~/domain/district/audit.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { isPlatformAdmin } from "~/domain/utils/host.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) {
    if ((user as { districtId?: string | null }).districtId) {
      throw redirect("/district");
    }
    if (user.orgId) throw redirect("/admin");
  }
  return null;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-white/80">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-white/50">{hint}</span> : null}
    </label>
  );
}

export default function DistrictSignup({ actionData }: Route.ComponentProps) {
  const error = (actionData as { error?: string } | undefined)?.error;
  return (
    <main className="min-h-screen bg-[#0f1414] px-4 py-12 text-white">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold">Sign up your district</h1>
        <p className="mt-2 text-sm text-white/60">
          Provision schools for your district from one portal. One bill,
          aggregate visibility, audit-logged access.
        </p>
        <Form method="post" className="mt-6 space-y-4">
          <Field label="District name">
            <Input name="districtName" required autoComplete="organization" />
          </Field>
          <Field label="Your name">
            <Input name="adminName" required autoComplete="name" />
          </Field>
          <Field label="Email">
            <Input
              name="adminEmail"
              type="email"
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <Input
              name="adminPassword"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </Field>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button
            type="submit"
            variant="primary"
            className="w-full bg-[#E9D500] font-semibold text-[#193B4B]"
          >
            Create district
          </Button>
        </Form>
      </div>
    </main>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "district-signup:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { error: "Too many attempts. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const form = await request.formData();
  const districtName = String(form.get("districtName") ?? "").trim();
  const adminName = String(form.get("adminName") ?? "").trim();
  const adminEmail = String(form.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPassword = String(form.get("adminPassword") ?? "");
  if (!districtName || !adminName || !adminEmail || adminPassword.length < 10) {
    return {
      error:
        "All fields are required, and the password must be at least 10 characters.",
    };
  }

  const db = getPrisma(context);
  const auth = getAuth(context);

  // Create the user first so we have a session cookie to forward on the
  // redirect. `returnHeaders: true` is what gives us the Set-Cookie headers
  // — without it, better-auth drops them and the browser never gets the
  // session, leaving the post-redirect loader to bounce to /login.
  const setCookieHeaders = new Headers();
  let signupResult: {
    headers: Headers;
    response: { user?: { id: string }; token?: string | null };
  };
  try {
    signupResult = await auth.api.signUpEmail({
      body: { name: adminName, email: adminEmail, password: adminPassword },
      returnHeaders: true,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not create the district admin account.",
    };
  }
  for (const c of signupResult.headers.getSetCookie?.() ?? []) {
    setCookieHeaders.append("Set-Cookie", c);
  }
  const userId = signupResult.response?.user?.id;
  if (!userId) {
    return { error: "Could not create the district admin account." };
  }

  // Skip district onboarding entirely for platform admins — they don't need
  // a District. The /platform layout's loader gates on isPlatformAdmin, so a
  // user without orgId/districtId still sees the staff panel.
  if (isPlatformAdmin({ email: adminEmail, role: "VIEWER" }, context)) {
    await db.user.update({
      where: { id: userId },
      data: { role: "PLATFORM_ADMIN" },
    });
    throw redirect("/platform", { headers: setCookieHeaders });
  }

  let district;
  try {
    district = await createDistrict(context, { name: districtName });
  } catch (err) {
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    return {
      error: err instanceof Error ? err.message : "Could not create district.",
    };
  }

  await db.user.update({
    where: { id: userId },
    data: { districtId: district.id, role: "ADMIN" },
  });

  await writeDistrictAudit(context, {
    districtId: district.id,
    actorUserId: userId,
    actorEmail: adminEmail,
    action: "district.admin.invited",
    targetType: "User",
    targetId: userId,
    details: { firstAdmin: true },
  });

  throw redirect("/district", { headers: setCookieHeaders });
}
