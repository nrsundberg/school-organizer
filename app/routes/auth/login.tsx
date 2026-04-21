import { Button, Input } from "@heroui/react";
import { data, Link, redirect } from "react-router";
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
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export function meta() {
  return [
    { title: "Login — Pickup Roster" },
    { name: "description", content: "Sign in to your school car line board" },
  ];
}

function safeInternalNextPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) return null;
  if (!user.orgId) throw redirect("/signup?step=2");

  const next = safeInternalNextPath(new URL(request.url).searchParams.get("next"));
  if (next) {
    throw redirect(next);
  }

  if (isPlatformAdmin(user, context)) {
    throw redirect("/platform");
  }

  const boardUrl = await getTenantBoardUrlForRequest(request, context);
  if (boardUrl) throw redirect(boardUrl);
  throw redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  const clientIp = clientIpFromRequest(request);
  const result = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "auth:" + clientIp,
  });
  if (!result.ok) {
    return data(
      { error: "Too many attempts. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  // login is handled client-side via better-auth; this action is a rate-limit gate
  return data({ error: null });
}

type Step = "email" | "password";

export default function Login() {
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
        setError("No account found for that email.");
        setLoading(false);
        return;
      }

      setStep("password");
    } catch {
      setError("Something went wrong. Please try again.");
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
        setError("Invalid password.");
        setLoading(false);
      } else {
        window.location.reload();
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">Log in</h1>
          <p className="mt-2 text-sm text-white/65">
            Sign in to manage your school&apos;s car line board.
          </p>

          {step === "email" ? (
            <form
              onSubmit={handleEmailNext}
              className="mt-6 flex w-full flex-col gap-3"
            >
              <label className="text-sm text-white/80" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@school.edu"
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
                Next
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleLogin}
              className="mt-6 flex w-full flex-col gap-3"
            >
              <p className="text-center text-sm text-white/80">{email}</p>
              <label className="text-sm text-white/80" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
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
                Sign in
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
                Use a different email
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
              Forgot password?
            </Link>
          </p>

          <p className="mt-6 text-center text-sm text-white/55">
            Need an account?{" "}
            <Link to="/signup" className="font-medium text-[#E9D500] hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
