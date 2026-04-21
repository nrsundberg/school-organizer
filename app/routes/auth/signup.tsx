import { Button, Input } from "@heroui/react";
import { data, Form, redirect, useActionData, useRouteLoaderData, useSearchParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { Route } from "./+types/signup";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { isMarketingHost, marketingOriginFromRequest } from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { ensureOrgForUser } from "~/domain/billing/onboarding.server";
import { getPrisma } from "~/db.server";
import { signUp } from "~/lib/auth-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  schoolBoardHostname,
  slugifyOrgName,
  suggestOrgSlugsFromName,
  tenantBoardUrlFromRequest,
} from "~/lib/org-slug";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export function meta() {
  return [
    { title: "Signup — Pickup Roster" },
    { name: "description", content: "Create your organization and account" },
  ];
}

/** Public plans accepted as `?plan=` query params on the signup route. */
const PUBLIC_PLAN_SLUGS = ["car-line", "campus", "district"] as const;
type PublicPlanSlug = (typeof PUBLIC_PLAN_SLUGS)[number];

function normalizePublicPlan(raw: string | null): PublicPlanSlug | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "car-line" || v === "car_line" || v === "carline") return "car-line";
  if (v === "campus") return "campus";
  if (v === "district") return "district";
  return null;
}

/** Map a public plan slug to its BillingPlan enum value. */
function billingPlanForSlug(slug: PublicPlanSlug): "CAR_LINE" | "CAMPUS" | "DISTRICT" {
  if (slug === "district") return "DISTRICT";
  if (slug === "campus") return "CAMPUS";
  return "CAR_LINE";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/`);
  }
  const user = getOptionalUserFromContext(context);
  if (user?.orgId) {
    const url = await getTenantBoardUrlForRequest(request, context);
    if (url) throw redirect(url);
    throw redirect("/");
  }
  // Require a plan selection. If absent/invalid, bounce to pricing so the user
  // picks a tier — there is no public free tier.
  const planParam = new URL(request.url).searchParams.get("plan");
  const plan = normalizePublicPlan(planParam);
  if (!plan) {
    throw redirect("/pricing");
  }
  return { plan };
}

const VALID_PLANS = ["CAR_LINE", "CAMPUS", "DISTRICT"] as const;
type Plan = (typeof VALID_PLANS)[number];

/**
 * Normalize a phone number to digits only, preserving a leading `+` if present.
 * Example: "+1 (555) 123-4567" -> "+15551234567"; "(555) 123-4567" -> "5551234567".
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  return hasPlus ? `+${digits}` : digits;
}

function countDigits(input: string): number {
  return (input.match(/\d/g) ?? []).length;
}

const step1Schema = z.object({
  name: z.string().min(1, "Please enter your name."),
  email: z.string().email(),
  phone: z
    .string()
    .refine((v) => countDigits(v) >= 10, "Phone number must be at least 10 digits."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const step3Schema = zfd.formData({
  orgName: zfd.text(z.string().min(2)),
  slug: zfd.text(z.string().min(1)),
  plan: zfd.text(z.enum(VALID_PLANS)),
});

export async function action({ request, context }: Route.ActionArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/`);
  }

  // 0. Rate limit by IP
  const clientIp = clientIpFromRequest(request);
  const rlResult = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "auth:" + clientIp,
  });
  if (!rlResult.ok) {
    return data(
      { error: "Too many attempts. Please try again in a minute.", field: undefined },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // 1. Require authed user
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return data({ error: "Your session expired. Please refresh and sign in again.", field: undefined }, { status: 401 });
  }
  const userId = session.user.id;
  const email = session.user.email;

  // 2. Parse FormData
  const formData = await request.formData();
  const parsed = step3Schema.safeParse(formData);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return data(
      { error: firstError?.message ?? "Invalid form data.", field: firstError?.path[0]?.toString() },
      { status: 400 },
    );
  }
  const { orgName, slug, plan } = parsed.data;

  // 3. Call ensureOrgForUser. Every new org starts as TRIALING with a 30-day
  //    trial window regardless of tier — we do NOT collect a card at signup.
  let orgId: string;
  try {
    const result = await ensureOrgForUser({
      context,
      userId,
      orgName,
      requestedSlug: slug,
      plan,
      email,
    });
    orgId = result.orgId;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unable to create organization.";
    const isSlugError = msg.toLowerCase().includes("slug");
    return data({ error: msg, field: isSlugError ? "slug" : undefined }, { status: 400 });
  }

  // 4. Redirect to the tenant board. The user is in-trial; Stripe customer /
  //    checkout flows are deferred until they convert from the billing page.
  const db = getPrisma(context);
  const org = await db.org.findUnique({ where: { id: orgId }, select: { slug: true } });
  const boardUrl = org?.slug ? tenantBoardUrlFromRequest(request, org.slug) : "/";
  throw redirect(boardUrl);
}

type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
};

export default function Signup({ loaderData }: Route.ComponentProps) {
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const authedUser = rootData?.user ?? null;
  const isAuthed = !!authedUser;
  const hasNoOrg = isAuthed && !authedUser.orgId;

  const [searchParams, setSearchParams] = useSearchParams();
  const stepParam = Number(searchParams.get("step")) || 1;
  const step = Math.min(3, Math.max(1, stepParam));

  // The plan is locked in by the ?plan= query param (the signup loader
  // redirects to /pricing if it's missing). We map the public slug to the
  // BillingPlan enum value the server action expects.
  const selectedPlanSlug = loaderData.plan;
  const initialPlan: Plan = billingPlanForSlug(selectedPlanSlug);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugVerifiedFor, setSlugVerifiedFor] = useState<string | null>(null);
  // Plan is read-only at step 3 — chosen from the pricing page via ?plan=.
  const plan: Plan = initialPlan;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);

  // Action data from the step 3 server action
  const actionData = useActionData<typeof action>();

  useEffect(() => {
    if ((step === 2 || step === 3) && !isAuthed) {
      setSearchParams({ step: "1" }, { replace: true });
    }
  }, [step, isAuthed, setSearchParams]);

  useEffect(() => {
    if (hasNoOrg && step === 1) {
      setSearchParams({ step: "2" }, { replace: true });
    }
  }, [hasNoOrg, step, setSearchParams]);

  const setStep = useCallback(
    (n: number) => {
      setSearchParams({ step: String(n) }, { replace: n === 1 });
    },
    [setSearchParams],
  );

  const slugNormalized = slugifyOrgName(slug);
  const slugIsVerified =
    !!slugNormalized && slugVerifiedFor === slugNormalized;

  useEffect(() => {
    if (slugVerifiedFor && slugifyOrgName(slug) !== slugVerifiedFor) {
      setSlugVerifiedFor(null);
    }
  }, [slug, slugVerifiedFor]);

  const [previewHost, setPreviewHost] = useState<string | null>(null);
  useEffect(() => {
    setPreviewHost(schoolBoardHostname(window.location.hostname, slugNormalized || "your-school"));
  }, [slugNormalized]);

  const handleStep1 = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const parsedStep1 = step1Schema.safeParse({ name, email, phone, password });
    if (!parsedStep1.success) {
      setError(parsedStep1.error.issues[0]?.message ?? "Please check your inputs.");
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    setLoading(true);
    try {
      const result = await signUp.email({
        email,
        password,
        name,
        phone: normalizedPhone,
      });
      if (result.error) {
        setError(result.error.message ?? "Unable to create account.");
        return;
      }
      setStep(2);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckSlug = async () => {
    setError(null);
    const normalized = slugifyOrgName(slug);
    if (!normalized) {
      setError("Enter a valid slug (letters, numbers, and hyphens).");
      return;
    }
    setCheckingSlug(true);
    try {
      const res = await fetch("/api/check-org-slug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const payload = (await res.json()) as {
        available?: boolean;
        error?: string;
        slug?: string;
      };
      if (res.status === 401) {
        setError("Your session expired. Refresh and sign in again.");
        return;
      }
      if (!res.ok) {
        setError(payload.error ?? "Could not check slug.");
        return;
      }
      if (payload.available) {
        setSlugVerifiedFor(payload.slug ?? normalized);
      } else {
        setSlugVerifiedFor(null);
        setError("That slug is already taken. Try another or pick a suggestion.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCheckingSlug(false);
    }
  };

  const handleStep2Next = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (orgName.trim().length < 2) {
      setError("School name must be at least 2 characters.");
      return;
    }
    if (!slugIsVerified) {
      setError('Check that your slug is available using "Check availability" before continuing.');
      return;
    }
    setStep(3);
  };

  const suggestions = suggestOrgSlugsFromName(orgName);

  // If action returned a slug error, go back to step 2
  useEffect(() => {
    if (actionData?.field === "slug") {
      setSlugVerifiedFor(null);
      setStep(2);
    }
  }, [actionData, setStep]);

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="mb-8 flex justify-center gap-2 text-sm">
          {(["Account", "School", "Plan"] as const).map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <div
                key={label}
                className={`flex items-center gap-2 ${active ? "text-[#E9D500] font-semibold" : done ? "text-white/70" : "text-white/40"}`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs ${
                    active
                      ? "border-[#E9D500] bg-[#E9D500]/15"
                      : done
                        ? "border-white/30 bg-white/5"
                        : "border-white/15"
                  }`}
                >
                  {n}
                </span>
                <span className="hidden sm:inline">{label}</span>
                {i < 2 && <span className="text-white/25">→</span>}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          {step === 1 && (
            <>
              <h1 className="text-2xl font-bold">Create your account</h1>
              <p className="mt-2 text-sm text-white/65">
                Use your work email. You&apos;ll set up your school next.
              </p>
              <form onSubmit={handleStep1} className="mt-6 flex flex-col gap-3">
                <label className="text-sm text-white/80">Your name</label>
                <Input
                  type="text"
                  placeholder="Jane Coach"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
                <label className="text-sm text-white/80">Email</label>
                <Input
                  type="email"
                  placeholder="you@school.edu"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <label className="text-sm text-white/80">Phone number</label>
                <Input
                  type="tel"
                  placeholder="(555) 123-4567"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
                <label className="text-sm text-white/80">Password</label>
                <Input
                  type="password"
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <label className="text-sm text-white/80">Confirm password</label>
                <Input
                  type="password"
                  placeholder="Repeat password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {error && <p className="text-center text-sm text-red-400">{error}</p>}
                <Button type="submit" isPending={loading} variant="primary" className="mt-2 bg-[#E9D500] font-semibold text-[#193B4B]">
                  Continue
                </Button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-bold">Your school</h1>
              <p className="mt-2 text-sm text-white/65">
                Your slug becomes part of your school&apos;s web address. It must be unique.
              </p>
              <form onSubmit={handleStep2Next} className="mt-6 flex flex-col gap-3">
                <label className="text-sm text-white/80">School / organization name</label>
                <Input
                  type="text"
                  placeholder="Maple Elementary"
                  required
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                  }}
                />
                <label className="text-sm text-white/80">URL slug</label>
                <Input
                  type="text"
                  placeholder="maple-elementary"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <p className="text-xs text-white/50">Lowercase letters, numbers, and hyphens.</p>
                {suggestions.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-white/50">Suggestions</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-white/85 hover:bg-white/10"
                          onClick={() => {
                            setSlug(s);
                            setSlugVerifiedFor(null);
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/75">
                  <p className="font-medium text-white/90">Your board URL</p>
                  <p className="mt-1 break-all font-mono text-xs text-[#E9D500]/90">
                    https://{previewHost ?? "…"}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    isPending={checkingSlug}
                    className="bg-[#193B4B] font-semibold text-white"
                    onPress={handleCheckSlug}
                  >
                    Check availability
                  </Button>
                  {slugIsVerified && (
                    <span className="text-sm text-emerald-400">Available — you can continue.</span>
                  )}
                </div>
                {error && <p className="text-center text-sm text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 border-white/20 text-white" onPress={() => setStep(1)}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={!slugIsVerified}
                    variant="primary"
                    className="flex-1 bg-[#E9D500] font-semibold text-[#193B4B]"
                  >
                    Continue
                  </Button>
                </div>
              </form>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-bold">Start your free trial</h1>
              <p className="mt-2 text-sm text-white/65">
                Your 30-day trial starts as soon as you finish setup. No credit
                card required.
                {plan === "DISTRICT" && (
                  <>
                    {" "}We&apos;ll reach out during your trial to discuss your
                    district&apos;s pricing and setup.
                  </>
                )}
              </p>
              <div className="mt-6 rounded-2xl border border-[#E9D500]/40 bg-[#193B4B]/30 p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-white/50">
                  Selected plan
                </p>
                <p className="mt-1 text-lg font-semibold text-[#E9D500]">
                  {plan === "DISTRICT"
                    ? "District"
                    : plan === "CAMPUS"
                      ? "Campus"
                      : "Car Line"}
                </p>
                <p className="mt-1 text-xs text-white/60">
                  {plan === "DISTRICT"
                    ? "Custom pricing — confirmed with you during the trial."
                    : plan === "CAMPUS"
                      ? "$500 / month per school after your 30-day trial."
                      : "$100 / month per school after your 30-day trial."}
                </p>
              </div>
              {/* Step 3 uses a real Form with server action */}
              <Form method="post" className="mt-6 flex flex-col gap-4">
                {/* Hidden fields for data collected in steps 1 & 2 */}
                <input type="hidden" name="orgName" value={orgName} />
                <input type="hidden" name="slug" value={slugNormalized} />
                <input type="hidden" name="plan" value={plan} />
                {actionData?.error && (
                  <p className="text-center text-sm text-red-400">{actionData.error}</p>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 border-white/20 text-white" onPress={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" variant="primary" className="flex-1 bg-[#E9D500] font-semibold text-[#193B4B]">
                    Start free trial
                  </Button>
                </div>
                <p className="text-center text-xs text-white/40">
                  By continuing you agree to our terms. You can change tiers
                  later by contacting support.
                </p>
              </Form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
