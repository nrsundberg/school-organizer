import { data } from "react-router";
import type { Route } from "./+types/onboarding";
import { getAuth } from "~/domain/auth/better-auth.server";
import { ensureOrgForUser, slugifyOrgName } from "~/domain/billing/onboarding.server";
import type { BillingPlan } from "~/db";

function asPlan(value: string | null): BillingPlan {
  if (value === "STARTER") return "STARTER";
  return "FREE";
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id || !session.user.email) {
    return data({ error: "Not authenticated." }, { status: 401 });
  }

  const body = (await request.json()) as {
    orgName?: string;
    slug?: string;
    plan?: string;
  };
  const orgName = body.orgName?.trim() ?? "";
  if (orgName.length < 2) {
    return data({ error: "Organization name must be at least 2 characters." }, { status: 400 });
  }

  const requestedSlug = slugifyOrgName(body.slug?.trim() || orgName);
  if (!requestedSlug) {
    return data({ error: "A valid organization slug is required." }, { status: 400 });
  }

  try {
    const result = await ensureOrgForUser({
      context,
      userId: session.user.id,
      email: session.user.email,
      orgName,
      requestedSlug,
      plan: asPlan(body.plan ?? null),
    });
    return data({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create organization.";
    return data({ error: message }, { status: 400 });
  }
}

