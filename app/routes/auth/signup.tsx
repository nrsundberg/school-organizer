import { Button, Input } from "@heroui/react";
import {
  data,
  Form,
  redirect,
  useActionData,
  useRevalidator,
  useRouteLoaderData,
  useSearchParams
} from "react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { Route } from "./+types/signup";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import {
  isMarketingHost,
  isPlatformAdmin,
  marketingOriginFromRequest
} from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { ensureOrgForUser } from "~/domain/billing/onboarding.server";
import {
  billingPlanForSlug,
  normalizePublicPlanSelectionSource,
  normalizePublicBillingCycle,
  normalizePublicPlan,
  pricingPathForPlan,
  PUBLIC_BILLING_CYCLES,
  PUBLIC_PLAN_SELECTION_SOURCES,
  shouldStartCheckoutAfterSignup,
  type PublicBillingCycle,
  type PublicPlanSelectionSource
} from "~/domain/billing/public-plans";
import { getPrisma } from "~/db.server";
import { signUp } from "~/lib/auth-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  schoolBoardHostname,
  slugifyOrgName,
  suggestOrgSlugsFromName,
  tenantBoardUrlFromRequest
} from "~/lib/org-slug";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter
} from "~/domain/utils/rate-limit.server";
import { createCheckoutSessionForOrg } from "~/domain/billing/checkout.server";
import { redirectWithError } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import { localizedErrorMap } from "~/lib/zod-error-map.server";

export const handle = { i18n: ["auth"] };

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Signup — Pickup Roster" },
    { name: "description", content: data?.metaDescription ?? "Create your organization and account" }
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/`);
  }
  // Old links from before the dedicated /district/signup route may still
  // pass ?plan=district. The flow they expect is the District wizard, not
  // the school wizard, so bounce to the right place.
  const url = new URL(request.url);
  if (url.searchParams.get("plan") === "district") {
    throw redirect("/district/signup");
  }
  const user = getOptionalUserFromContext(context);
  if (user?.orgId) {
    const url = await getTenantBoardUrlForRequest(request, context);
    if (url) throw redirect(url);
    throw redirect("/");
  }
  // Require a plan selection. If absent/invalid, bounce to pricing so the user
  // picks a tier — there is no public free tier. Exception: users who've
  // already completed step 1 (authed, no org yet) fall back to car-line so a
  // lost `?plan=` param mid-flow doesn't strand them.
  const planParam = url.searchParams.get("plan");
  const plan = normalizePublicPlan(planParam);
  if (!plan && !user) {
    throw redirect("/pricing");
  }
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return {
    plan: plan ?? "car-line",
    billingCycle: normalizePublicBillingCycle(url.searchParams.get("cycle")),
    planSelectionSource: normalizePublicPlanSelectionSource(
      plan ? "explicit" : null
    ),
    metaTitle: t("signup.metaTitle"),
    metaDescription: t("signup.metaDescription"),
  };
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
  name: z.string().min(1, "auth:signup.errors.enterName"),
  email: z.string().email(),
  phone: z
    .string()
    .refine(
      (v) => countDigits(v) >= 10,
      "auth:signup.errors.phoneTooShort"
    ),
  password: z.string().min(8, "auth:signup.errors.passwordTooShort")
});

const step3Schema = zfd.formData({
  orgName: zfd.text(z.string().min(2)),
  slug: zfd.text(z.string().min(1)),
  plan: zfd.text(z.enum(VALID_PLANS)),
  billingCycle: zfd.text(z.enum(PUBLIC_BILLING_CYCLES).optional()),
  planSelectionSource: zfd.text(
    z.enum(PUBLIC_PLAN_SELECTION_SOURCES).optional()
  )
});

export async function action({ request, context }: Route.ActionArgs) {
  if (!isMarketingHost(request, context)) {
    throw redirect(`${marketingOriginFromRequest(request, context)}/`);
  }

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  const tErrors = await getFixedT(locale, "errors");

  // 0. Rate limit by IP
  const clientIp = clientIpFromRequest(request);
  const rlResult = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "auth:" + clientIp
  });
  if (!rlResult.ok) {
    return data(
      {
        error: t("signup.errors.rateLimited"),
        field: undefined
      },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // 1. Require authed user
  const auth = getAuth(context);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return data(
      {
        error: t("signup.errors.sessionExpired"),
        field: undefined
      },
      { status: 401 }
    );
  }
  const userId = session.user.id;
  const email = session.user.email;

  // Skip school onboarding entirely for platform admins — they don't need
  // an Org. The /platform layout's loader gates on isPlatformAdmin, so a
  // user without orgId/districtId still sees the staff panel.
  const sessionUser = session.user as { email: string; role?: string };
  if (
    isPlatformAdmin(
      { email: sessionUser.email, role: sessionUser.role ?? "VIEWER" },
      context,
    )
  ) {
    throw redirect("/platform");
  }

  // 2. Parse FormData
  const formData = await request.formData();
  const parsed = step3Schema.safeParse(formData, {
    error: localizedErrorMap(tErrors),
  });
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return data(
      {
        error: firstError?.message ?? t("signup.errors.invalidForm"),
        field: firstError?.path[0]?.toString()
      },
      { status: 400 }
    );
  }
  const { orgName, slug, plan } = parsed.data;
  const billingCycle = parsed.data.billingCycle ?? "monthly";
  const planSelectionSource = parsed.data.planSelectionSource ?? "default";
  const startsInCheckout = shouldStartCheckoutAfterSignup(
    plan,
    planSelectionSource
  );

  // 3. Create the org first so signup can either continue into checkout for
  //    an explicitly-selected self-serve paid plan, or keep the existing
  //    board redirect for district/default flows.
  let orgId: string;
  try {
    const result = await ensureOrgForUser({
      context,
      userId,
      orgName,
      requestedSlug: slug,
      plan,
      email
    });
    orgId = result.orgId;
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : t("signup.errors.createOrgFailed");
    const isSlugError = msg.toLowerCase().includes("slug");
    return data(
      { error: msg, field: isSlugError ? "slug" : undefined },
      { status: 400 }
    );
  }

  if (startsInCheckout) {
    try {
      const origin = new URL(request.url).origin;
      const successUrl = `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = new URL(
        pricingPathForPlan(plan, billingCycle),
        origin
      ).toString();
      const { url } = await createCheckoutSessionForOrg({
        context,
        orgId,
        plan,
        billingCycle,
        email,
        successUrl,
        cancelUrl
      });
      throw redirect(url);
    } catch (error) {
      if (error instanceof Response) throw error;
      const message =
        error instanceof Error
          ? error.message
          : t("signup.errors.couldNotStartCheckout");
      return redirectWithError(pricingPathForPlan(plan, billingCycle), message);
    }
  }

  // 4. District and default/fallback flows keep the current no-card trial path.
  const db = getPrisma(context);
  const org = await db.org.findUnique({
    where: { id: orgId },
    select: { slug: true }
  });
  const boardUrl = org?.slug
    ? tenantBoardUrlFromRequest(request, org.slug)
    : "/";
  throw redirect(boardUrl);
}

type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
  isPlatformAdmin?: boolean;
};

export default function Signup({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const authedUser = rootData?.user ?? null;
  const isAuthed = !!authedUser;
  const hasNoOrg = isAuthed && !authedUser.orgId;

  const [searchParams, setSearchParams] = useSearchParams();
  const stepParam = Number(searchParams.get("step")) || 1;
  const step = Math.min(3, Math.max(1, stepParam));
  const revalidator = useRevalidator();

  // Set to true the moment `signUp.email()` resolves so the bounce-back
  // effect below doesn't kick the user back to step 1 in the window
  // between "cookie is set" and "root loader has revalidated". See the
  // 2026-04-23-2317-scan P0 for the full repro.
  const [justSignedUp, setJustSignedUp] = useState(false);

  // The plan is locked in by the ?plan= query param (the signup loader
  // redirects to /pricing if it's missing). We map the public slug to the
  // BillingPlan enum value the server action expects.
  const selectedPlanSlug = loaderData.plan;
  const initialPlan: Plan = billingPlanForSlug(selectedPlanSlug);
  const selectedBillingCycle = loaderData.billingCycle as PublicBillingCycle;
  const planSelectionSource =
    loaderData.planSelectionSource as PublicPlanSelectionSource;
  const startsInCheckout = shouldStartCheckoutAfterSignup(
    initialPlan,
    planSelectionSource
  );

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

  // Preserve all existing search params (notably `?plan=`) when updating the
  // step — `setSearchParams({...})` replaces the whole param set, which
  // otherwise wipes the plan and sends the user back to /pricing.
  const updateStepParam = useCallback(
    (n: number, opts?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("step", String(n));
          return next;
        },
        { replace: opts?.replace ?? n === 1 }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    if ((step === 2 || step === 3) && !isAuthed && !justSignedUp) {
      updateStepParam(1, { replace: true });
    }
  }, [step, isAuthed, updateStepParam, justSignedUp]);

  useEffect(() => {
    if (hasNoOrg && step === 1) {
      updateStepParam(2, { replace: true });
    }
  }, [hasNoOrg, step, updateStepParam]);

  // Platform admins (per PLATFORM_ADMIN_EMAILS) don't need to set up an
  // org — once they've authed they go straight to the staff panel.
  useEffect(() => {
    if (justSignedUp && rootData?.isPlatformAdmin === true) {
      window.location.href = "/platform";
    }
  }, [justSignedUp, rootData?.isPlatformAdmin]);

  const setStep = useCallback(
    (n: number) => {
      updateStepParam(n);
    },
    [updateStepParam]
  );

  const slugNormalized = slugifyOrgName(slug);
  const slugIsVerified = !!slugNormalized && slugVerifiedFor === slugNormalized;

  useEffect(() => {
    if (slugVerifiedFor && slugifyOrgName(slug) !== slugVerifiedFor) {
      setSlugVerifiedFor(null);
    }
  }, [slug, slugVerifiedFor]);

  const [previewHost, setPreviewHost] = useState<string | null>(null);
  useEffect(() => {
    setPreviewHost(
      schoolBoardHostname(
        window.location.hostname,
        slugNormalized || "your-school"
      )
    );
  }, [slugNormalized]);

  // Translate Zod issue keys (we encoded "auth:signup.errors.*" sentinels
  // as the message above) — fall back to the raw issue if it doesn't look
  // like one of our keys.
  const translateZodMessage = (message: string | undefined): string => {
    if (!message) return t("signup.errors.checkInputs");
    if (message.startsWith("auth:")) return t(message.slice("auth:".length));
    return message;
  };

  const handleStep1 = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(t("signup.errors.passwordsDoNotMatch"));
      return;
    }
    const parsedStep1 = step1Schema.safeParse({ name, email, phone, password });
    if (!parsedStep1.success) {
      setError(translateZodMessage(parsedStep1.error.issues[0]?.message));
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    setLoading(true);
    try {
      const result = await signUp.email({
        email,
        password,
        name,
        phone: normalizedPhone
      });
      if (result.error) {
        setError(result.error.message ?? t("signup.errors.createAccountFailed"));
        return;
      }
      // signUp.email() has set the session cookie. Tell the bounce-back
      // effect not to fire while root re-runs, then force root to
      // revalidate so `rootData.user` becomes non-null.
      setJustSignedUp(true);
      revalidator.revalidate();
      setStep(2);
    } catch {
      setError(t("signup.errors.generic"));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckSlug = async () => {
    setError(null);
    const normalized = slugifyOrgName(slug);
    if (!normalized) {
      setError(t("signup.errors.invalidSlug"));
      return;
    }
    setCheckingSlug(true);
    try {
      const res = await fetch("/api/check-org-slug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug })
      });
      const payload = (await res.json()) as {
        available?: boolean;
        error?: string;
        slug?: string;
      };
      if (res.status === 401) {
        setError(t("signup.errors.sessionExpiredShort"));
        return;
      }
      if (!res.ok) {
        setError(payload.error ?? t("signup.errors.couldNotCheckSlug"));
        return;
      }
      if (payload.available) {
        setSlugVerifiedFor(payload.slug ?? normalized);
      } else {
        setSlugVerifiedFor(null);
        setError(t("signup.errors.slugTaken"));
      }
    } catch {
      setError(t("signup.errors.generic"));
    } finally {
      setCheckingSlug(false);
    }
  };

  const handleStep2Next = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (orgName.trim().length < 2) {
      setError(t("signup.errors.schoolNameTooShort"));
      return;
    }
    if (!slugIsVerified) {
      setError(t("signup.errors.checkSlug"));
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

  const stepLabels = [
    t("signup.stepper.account"),
    t("signup.stepper.school"),
    t("signup.stepper.plan"),
  ];

  const planNameLabel =
    plan === "DISTRICT"
      ? t("signup.step3.planNames.district")
      : plan === "CAMPUS"
        ? t("signup.step3.planNames.campus")
        : t("signup.step3.planNames.carLine");

  const cycleLabel = t(
    selectedBillingCycle === "annual"
      ? "signup.step3.cycle.annual"
      : "signup.step3.cycle.monthly"
  );

  const planDescription = (() => {
    if (plan === "DISTRICT") {
      return t("signup.step3.planDescriptions.district");
    }
    if (plan === "CAMPUS") {
      return startsInCheckout
        ? t("signup.step3.planDescriptions.campusCheckout", { cycle: cycleLabel })
        : t("signup.step3.planDescriptions.campus", { cycle: cycleLabel });
    }
    return startsInCheckout
      ? t("signup.step3.planDescriptions.carLineCheckout", { cycle: cycleLabel })
      : t("signup.step3.planDescriptions.carLine", { cycle: cycleLabel });
  })();

  const step3Title = startsInCheckout
    ? t("signup.step3.titleCheckout")
    : t("signup.step3.title");
  const step3Subtitle = startsInCheckout
    ? t("signup.step3.subtitleCheckout")
    : t("signup.step3.subtitle");
  const step3Submit = startsInCheckout
    ? t("signup.step3.submitCheckout")
    : t("signup.step3.submit");
  const step3Terms = startsInCheckout
    ? t("signup.step3.termsCheckout")
    : t("signup.step3.terms");

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="mb-8 flex justify-center gap-2 text-sm">
          {stepLabels.map((label, i) => {
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
              <h1 className="text-2xl font-bold">{t("signup.step1.title")}</h1>
              <p className="mt-2 text-sm text-white/65">
                {t("signup.step1.subtitle")}
              </p>
              <form onSubmit={handleStep1} className="mt-6 flex flex-col gap-3">
                <label className="text-sm text-white/80" htmlFor="signup-name">
                  {t("signup.step1.nameLabel")}
                </label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder={t("signup.step1.namePlaceholder")}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
                <label className="text-sm text-white/80" htmlFor="signup-email">
                  {t("signup.step1.emailLabel")}
                </label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder={t("signup.step1.emailPlaceholder")}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <label className="text-sm text-white/80" htmlFor="signup-phone">
                  {t("signup.step1.phoneLabel")}
                </label>
                <Input
                  id="signup-phone"
                  type="tel"
                  placeholder={t("signup.step1.phonePlaceholder")}
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
                <label
                  className="text-sm text-white/80"
                  htmlFor="signup-password"
                >
                  {t("signup.step1.passwordLabel")}
                </label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder={t("signup.step1.passwordPlaceholder")}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <label
                  className="text-sm text-white/80"
                  htmlFor="signup-confirm-password"
                >
                  {t("signup.step1.confirmLabel")}
                </label>
                <Input
                  id="signup-confirm-password"
                  type="password"
                  placeholder={t("signup.step1.confirmPlaceholder")}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {error && (
                  <p className="text-center text-sm text-red-400">{error}</p>
                )}
                <Button
                  type="submit"
                  isPending={loading}
                  variant="primary"
                  className="mt-2 bg-[#E9D500] font-semibold text-[#193B4B]"
                >
                  {t("signup.step1.continue")}
                </Button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-2xl font-bold">{t("signup.step2.title")}</h1>
              <p className="mt-2 text-sm text-white/65">
                {t("signup.step2.subtitle")}
              </p>
              <form
                onSubmit={handleStep2Next}
                className="mt-6 flex flex-col gap-3"
              >
                <label
                  className="text-sm text-white/80"
                  htmlFor="signup-org-name"
                >
                  {t("signup.step2.orgNameLabel")}
                </label>
                <Input
                  id="signup-org-name"
                  type="text"
                  placeholder={t("signup.step2.orgNamePlaceholder")}
                  required
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                  }}
                />
                <label className="text-sm text-white/80" htmlFor="signup-slug">
                  {t("signup.step2.slugLabel")}
                </label>
                <Input
                  id="signup-slug"
                  type="text"
                  placeholder={t("signup.step2.slugPlaceholder")}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
                <p className="text-xs text-white/50">
                  {t("signup.step2.slugHelp")}
                </p>
                {suggestions.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-white/50">{t("signup.step2.suggestions")}</p>
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
                  <p className="font-medium text-white/90">{t("signup.step2.boardUrlLabel")}</p>
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
                    {t("signup.step2.checkAvailability")}
                  </Button>
                  {slugIsVerified && (
                    <span className="text-sm text-emerald-400">
                      {t("signup.step2.available")}
                    </span>
                  )}
                </div>
                {error && (
                  <p className="text-center text-sm text-red-400">{error}</p>
                )}
                <Button
                  type="submit"
                  isDisabled={!slugIsVerified}
                  variant="primary"
                  className="bg-[#E9D500] font-semibold text-[#193B4B]"
                >
                  {t("signup.step2.continue")}
                </Button>
              </form>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-2xl font-bold">{step3Title}</h1>
              <p className="mt-2 text-sm text-white/65">
                {step3Subtitle}
                {!startsInCheckout && plan === "DISTRICT" && (
                  <> {t("signup.step3.districtAddon")}</>
                )}
              </p>
              <div className="mt-6 rounded-2xl border border-[#E9D500]/40 bg-[#193B4B]/30 p-4 text-sm">
                <p className="text-xs uppercase tracking-wide text-white/50">
                  {t("signup.step3.selectedPlan")}
                </p>
                <p className="mt-1 text-lg font-semibold text-[#E9D500]">
                  {planNameLabel}
                </p>
                <p className="mt-1 text-xs text-white/60">
                  {planDescription}
                </p>
              </div>
              {/* Step 3 uses a real Form with server action */}
              <Form method="post" className="mt-6 flex flex-col gap-4">
                {/* Hidden fields for data collected in steps 1 & 2 */}
                <input type="hidden" name="orgName" value={orgName} />
                <input type="hidden" name="slug" value={slugNormalized} />
                <input type="hidden" name="plan" value={plan} />
                <input
                  type="hidden"
                  name="billingCycle"
                  value={selectedBillingCycle}
                />
                <input
                  type="hidden"
                  name="planSelectionSource"
                  value={planSelectionSource}
                />
                {actionData?.error && (
                  <p className="text-center text-sm text-red-400">
                    {actionData.error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-white/20 text-white"
                    onPress={() => setStep(2)}
                  >
                    {t("signup.step3.back")}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 bg-[#E9D500] font-semibold text-[#193B4B]"
                  >
                    {step3Submit}
                  </Button>
                </div>
                <p className="text-center text-xs text-white/40">
                  {step3Terms}
                </p>
              </Form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
