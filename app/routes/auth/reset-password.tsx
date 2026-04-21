import { Button, Input } from "@heroui/react";
import { data, Form, Link } from "react-router";
import { redirectWithSuccess } from "remix-toast";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useState } from "react";
import type { Route } from "./+types/reset-password";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import {
  consumePasswordResetToken,
  lookupPasswordResetToken,
} from "~/domain/auth/password-reset.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export function meta() {
  return [{ title: "Reset password — Pickup Roster" }];
}

// Must match the signup form's rule in app/routes/auth/signup.tsx (min 8).
// Keep in sync if that rule ever tightens.
const MIN_PASSWORD_LENGTH = 8;

const actionSchema = zfd.formData({
  token: zfd.text(z.string().min(1)),
  password: zfd.text(z.string().min(MIN_PASSWORD_LENGTH)),
  confirm: zfd.text(z.string().min(MIN_PASSWORD_LENGTH)),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim() ?? "";
  if (!rawToken) {
    return { state: "invalid" as const, token: "" };
  }
  const lookup = await lookupPasswordResetToken(context, rawToken);
  if (!lookup.ok) {
    return { state: "invalid" as const, token: "", reason: lookup.reason };
  }
  return { state: "valid" as const, token: rawToken };
}

export async function action({ request, context }: Route.ActionArgs) {
  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "reset-password:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const formData = await request.formData();
  const parsed = actionSchema.safeParse(formData);
  if (!parsed.success) {
    return data(
      {
        error:
          parsed.error.issues.find((i) => i.path[0] === "password")
            ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
            : "Please fill out both fields.",
      },
      { status: 400 },
    );
  }
  const { token, password, confirm } = parsed.data;

  if (password !== confirm) {
    return data({ error: "Passwords do not match." }, { status: 400 });
  }

  const result = await consumePasswordResetToken(context, {
    rawToken: token,
    newPassword: password,
  });
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "That reset link has expired. Request a new one."
        : result.reason === "used"
          ? "That reset link has already been used. Request a new one."
          : result.reason === "org-disabled"
            ? "Password reset is disabled for your organization. Contact your admin."
            : "That reset link is invalid. Request a new one.";
    return data({ error: message }, { status: 400 });
  }

  throw await redirectWithSuccess("/login", {
    message: "Password updated. Please log in with your new password.",
  });
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (loaderData.state === "invalid") {
    return (
      <div className="min-h-screen bg-[#0f1414] text-white">
        <MarketingNav />
        <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
          <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
            <h1 className="text-2xl font-bold">Reset link invalid</h1>
            <p className="mt-2 text-sm text-white/65">
              This link has expired, already been used, or isn&apos;t recognized.
              Start over and we&apos;ll send you a fresh one.
            </p>
            <div className="mt-6">
              <Link
                to="/forgot-password"
                className="inline-flex items-center rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:brightness-95"
              >
                Request a new link
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">Choose a new password</h1>
          <p className="mt-2 text-sm text-white/65">
            At least {MIN_PASSWORD_LENGTH} characters. After saving, you&apos;ll
            be logged out of all devices and need to sign in again.
          </p>

          <Form method="post" className="mt-6 flex w-full flex-col gap-3">
            <input type="hidden" name="token" value={loaderData.token} />
            <label className="text-sm text-white/80" htmlFor="password">
              New password
            </label>
            <Input
              id="password"
              type="password"
              name="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
            <label className="text-sm text-white/80" htmlFor="confirm">
              Confirm password
            </label>
            <Input
              id="confirm"
              type="password"
              name="confirm"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {actionData?.error && (
              <p className="text-center text-sm text-red-400">{actionData.error}</p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
            >
              Save new password
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
