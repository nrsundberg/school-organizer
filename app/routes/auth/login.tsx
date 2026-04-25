import { Button, Input } from "@heroui/react";
import { data, Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { isPlatformAdmin } from "~/domain/utils/host.server";
import { getTenantBoardUrlForRequest } from "~/domain/utils/tenant-board-url.server";
import type { Route } from "./+types/login";
import { useState } from "react";
import { signIn } from "~/lib/auth-client";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter
} from "~/domain/utils/rate-limit.server";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";
import { readAuthErrorShape, translateAuthError } from "~/lib/auth-errors";

export const handle = { i18n: ["auth", "errors"] };

export function meta({ data }: { data?: { metaTitle?: string; metaDescription?: string } }) {
  return [
    { title: data?.metaTitle ?? "Login — Pickup Roster" },
    { name: "description", content: data?.metaDescription ?? "Sign in to your school car line board" },
  ];
}

function safeInternalNextPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) {
    const next = safeInternalNextPath(new URL(request.url).searchParams.get("next"));
    if (next) {
      throw redirect(next);
    }

    if (isPlatformAdmin(user, context)) {
      throw redirect("/platform");
    }

    // District admins land in the district portal. Has to come before the
    // !user.orgId check below since district-scoped users have no orgId.
    if ((user as { districtId?: string | null }).districtId) {
      throw redirect("/district");
    }

    if (!user.orgId) throw redirect("/signup?step=2");

    const boardUrl = await getTenantBoardUrlForRequest(request, context);
    if (boardUrl) throw redirect(boardUrl);
    throw redirect("/");
  }

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  return {
    metaTitle: t("login.metaTitle"),
    metaDescription: t("login.metaDescription"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const clientIp = clientIpFromRequest(request);
  const result = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "auth:" + clientIp
  });
  if (!result.ok) {
    const locale = await detectLocale(request, context);
    const t = await getFixedT(locale, "auth");
    return data(
      { error: t("login.errors.rateLimited") },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  // login is handled client-side via better-auth; this action is a rate-limit gate
  return data({ error: null });
}

type Step = "email" | "password";

export default function Login() {
  const { t } = useTranslation(["auth", "errors"]);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEmailNext = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const { exists } = (await res.json()) as { exists: boolean };

      if (!exists) {
        setError(t("login.errors.noAccount"));
        setLoading(false);
        return;
      }

      setStep("password");
    } catch {
      setError(t("login.errors.generic"));
    }

    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        const { code, message } = readAuthErrorShape(result.error);
        setError(
          translateAuthError(
            code,
            t,
            message ?? t("auth:login.errors.invalidPassword"),
          ),
        );
        setLoading(false);
      } else {
        window.location.reload();
      }
    } catch {
      setError(t("auth:login.errors.generic"));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">{t("login.title")}</h1>
          <p className="mt-2 text-sm text-white/65">
            {t("login.subtitle")}
          </p>

          {step === "email" ? (
            <form
              onSubmit={handleEmailNext}
              className="mt-6 flex w-full flex-col gap-3"
            >
              <label className="text-sm text-white/80" htmlFor="email">
                {t("login.emailLabel")}
              </label>
              <Input
                id="email"
                type="email"
                placeholder={t("login.emailPlaceholder")}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              {error && (
                <p className="text-center text-sm text-red-400">{error}</p>
              )}
              <Button
                type="submit"
                isPending={loading}
                variant="primary"
                className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
              >
                {t("login.next")}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleLogin}
              className="mt-6 flex w-full flex-col gap-3"
            >
              <p className="text-center text-sm text-white/80">{email}</p>
              <label className="text-sm text-white/80" htmlFor="password">
                {t("login.passwordLabel")}
              </label>
              <Input
                id="password"
                type="password"
                placeholder={t("login.passwordPlaceholder")}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {error && (
                <p className="text-center text-sm text-red-400">{error}</p>
              )}
              <Button
                type="submit"
                isPending={loading}
                variant="primary"
                className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
              >
                {t("login.submit")}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setPassword("");
                }}
                className="text-center text-sm text-white/50 transition hover:text-white"
              >
                {t("login.useDifferentEmail")}
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-white/55">
            {/*
              Always render the forgot-password link — we don't yet know the
              org at step 1 (email hasn't been submitted) and rendering it
              conditionally would leak tenant membership. The action at
              /forgot-password gates on the org's `passwordResetEnabled`
              toggle and returns a generic success regardless.
            */}
            <Link
              to="/forgot-password"
              className="font-medium text-white/70 hover:text-white hover:underline"
            >
              {t("login.forgot")}
            </Link>
          </p>

          <p className="mt-6 text-center text-sm text-white/55">
            {t("login.needAccount")}{" "}
            <Link to="/signup" className="font-medium text-[#E9D500] hover:underline">
              {t("login.signupCta")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
