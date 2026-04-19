import { Button, Input } from "@heroui/react";
import { redirect, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/signup";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { isMarketingHost, marketingOriginFromRequest } from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import { signUp } from "~/lib/auth-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  schoolBoardHostname,
  slugifyOrgName,
  suggestOrgSlugsFromName,
  tenantBoardUrlFromRequest,
} from "~/lib/org-slug";
import { TRIAL_CALENDAR_DAYS, TRIAL_QUALIFYING_DAYS } from "~/lib/trial-rules";

export function meta() {
  return [
    { title: "Signup — School Organizer" },
    { name: "description", content: "Create your organization and account" },
  ];
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
  return null;
}

type Plan = "FREE" | "CAR_LINE" | "CAMPUS";

type RootLoader = {
  user?: { id: string; orgId: string | null } | null;
};

export default function Signup() {
  const rootData = useRouteLoaderData("root") as RootLoader | undefined;
  const authedUser = rootData?.user ?? null;
  const isAuthed = !!authedUser;
  const hasNoOrg = isAuthed && !authedUser.orgId;

  const [searchParams, setSearchParams] = useSearchParams();
  const stepParam = Number(searchParams.get("step")) || 1;
  const step = Math.min(3, Math.max(1, stepParam));

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugVerifiedFor, setSlugVerifiedFor] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>("FREE");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSlug, setCheckingSlug] = useState(false);

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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.email({
        email,
        password,
        name,
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

  const handleFinish = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const orgRes = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: orgName.trim(),
          slug: slugNormalized,
          plan,
        }),
      });
      const payload = (await orgRes.json()) as { error?: string };
      if (!orgRes.ok) {
        setError(payload.error ?? "Unable to create organization.");
        if (orgRes.status === 400 && payload.error?.toLowerCase().includes("slug")) {
          setSlugVerifiedFor(null);
          setStep(2);
        }
        return;
      }
      window.location.href = tenantBoardUrlFromRequest(
        new Request(window.location.href),
        slugNormalized,
      );
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const suggestions = suggestOrgSlugsFromName(orgName);

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
              <h1 className="text-2xl font-bold">Choose a plan</h1>
              <p className="mt-2 text-sm text-white/65">
                Trial length is the later of{" "}
                <strong className="text-white/90">{TRIAL_CALENDAR_DAYS} calendar days</strong> from signup or reaching{" "}
                <strong className="text-white/90">{TRIAL_QUALIFYING_DAYS} qualifying pickup days</strong> (busy days with
                enough students on the board)—whichever finishes last.
              </p>
              <form onSubmit={handleFinish} className="mt-6 flex flex-col gap-4">
                <label className="block cursor-pointer rounded-2xl border border-white/10 bg-black/20 p-4 has-[:checked]:border-[#E9D500]/50">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="plan"
                      checked={plan === "FREE"}
                      onChange={() => setPlan("FREE")}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold">Free trial</p>
                      <p className="mt-1 text-sm text-white/65">
                        Full board on your school subdomain. Usage limits match Car Line; upgrade when you need more capacity
                        or paid billing.
                      </p>
                    </div>
                  </div>
                </label>
                <label className="block cursor-pointer rounded-2xl border border-white/10 bg-black/20 p-4 has-[:checked]:border-[#E9D500]/50">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="plan"
                      checked={plan === "CAR_LINE"}
                      onChange={() => setPlan("CAR_LINE")}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold text-[#E9D500]">Car Line</p>
                      <p className="mt-1 text-sm text-white/65">
                        Stripe subscription — car line + subdomain. See pricing for student, family, and classroom limits.
                      </p>
                    </div>
                  </div>
                </label>
                <label className="block cursor-pointer rounded-2xl border border-[#E9D500]/30 bg-[#193B4B]/30 p-4 has-[:checked]:border-[#E9D500]">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="plan"
                      checked={plan === "CAMPUS"}
                      onChange={() => setPlan("CAMPUS")}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold text-[#E9D500]">Campus</p>
                      <p className="mt-1 text-sm text-white/65">
                        Higher limits (e.g. ~300 families / 900 students), forms &amp; custom pages, optional SMS/email add-ons.
                      </p>
                    </div>
                  </div>
                </label>
                {error && <p className="text-center text-sm text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 border-white/20 text-white" onPress={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" isPending={loading} variant="primary" className="flex-1 bg-[#E9D500] font-semibold text-[#193B4B]">
                    Finish setup
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
