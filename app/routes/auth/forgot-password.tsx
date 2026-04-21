import { Button, Input } from "@heroui/react";
import { data, Form, Link } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useState } from "react";
import type { Route } from "./+types/forgot-password";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getPrisma } from "~/db.server";
import { createPasswordResetToken } from "~/domain/auth/password-reset.server";
import { enqueueEmail } from "~/domain/email/queue.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import { marketingOriginFromRequest } from "~/domain/utils/host.server";

export function meta() {
  return [
    { title: "Forgot password — Pickup Roster" },
    {
      name: "description",
      content: "Start a password reset for your PickupRoster account.",
    },
  ];
}

const schema = zfd.formData({
  email: zfd.text(z.string().trim().toLowerCase().email()),
});

function firstNameFromUserName(name: string | null | undefined): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

function resetUrlFor(request: Request, context: any, rawToken: string): string {
  // Reset links are sent over email; recipients may click from a phone
  // that doesn't know which tenant subdomain they use. Anchor on the
  // marketing origin (apex) so the link always resolves.
  const base = marketingOriginFromRequest(request, context).replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export async function action({ request, context }: Route.ActionArgs) {
  // Rate limit by IP using the existing auth limiter. Forgotten-password is
  // a cheap user-enum vector if unmetered.
  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "forgot-password:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { ok: false as const, error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const formData = await request.formData();
  const parsed = schema.safeParse(formData);
  if (!parsed.success) {
    // Don't leak precisely which field failed — generic error is fine.
    return data({ ok: true as const }, { status: 200 });
  }
  const { email } = parsed.data;

  // Cast to any for the same reason as password-reset.server.ts: the
  // generated Prisma client doesn't surface the new `passwordResetEnabled`
  // column on Org until `prisma generate` runs in the build pipeline.
  const db = getPrisma(context) as any;
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      orgId: true,
      org: { select: { passwordResetEnabled: true } },
    },
  });

  // User enumeration defence: we ALWAYS return a generic success response.
  // Only enqueue the email if the user exists AND their org allows password
  // reset. Anything else → no-op, same response.
  const orgAllowsReset = user?.org ? user.org.passwordResetEnabled !== false : true;
  if (user && orgAllowsReset) {
    const userAgent = request.headers.get("user-agent");
    const { rawToken } = await createPasswordResetToken(context, {
      userId: user.id,
      requestIp: clientIp,
      requestUserAgent: userAgent,
    });
    const resetUrl = resetUrlFor(request, context, rawToken);
    await enqueueEmail(context, {
      kind: "password_reset",
      to: user.email,
      firstName: firstNameFromUserName(user.name),
      resetUrl,
      expiryMinutes: 60,
      requestIp: clientIp,
    });
  }

  return data({ ok: true as const });
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const [email, setEmail] = useState("");
  const submitted = actionData?.ok === true;
  const rlError = actionData?.ok === false ? actionData.error : null;

  return (
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">Forgot your password?</h1>
          <p className="mt-2 text-sm text-white/65">
            Enter the email on your account and we&apos;ll send you a link to pick
            a new password.
          </p>

          {submitted ? (
            <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <p className="font-medium">Check your inbox.</p>
              <p className="mt-1 text-emerald-100/80">
                If an account matches that email and password reset is enabled for
                your organization, we just sent a link. It expires in 60 minutes.
              </p>
              <p className="mt-3 text-xs text-emerald-100/60">
                Didn&apos;t get one? Your organization may use single sign-on — ask
                your admin how to get in.
              </p>
            </div>
          ) : (
            <Form method="post" className="mt-6 flex w-full flex-col gap-3">
              <label className="text-sm text-white/80" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                name="email"
                placeholder="you@school.edu"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              {rlError && (
                <p className="text-center text-sm text-red-400">{rlError}</p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
              >
                Send reset link
              </Button>
            </Form>
          )}

          <p className="mt-6 text-center text-sm text-white/55">
            Remembered it?{" "}
            <Link to="/login" className="font-medium text-[#E9D500] hover:underline">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
