import { Button, Input } from "@heroui/react";
import { data, Form, Link, redirect } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { Route } from "./+types/accept-invite";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getPrisma } from "~/db.server";
import { hashPassword, getAuth } from "~/domain/auth/better-auth.server";
import {
  consumeInviteToken,
  lookupInviteToken,
} from "~/domain/auth/user-invite.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export const handle = { i18n: ["auth"] };

export function meta() {
  return [{ title: "Accept invite — Pickup Roster" }];
}

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
    return { state: "invalid" as const, token: "", email: "" };
  }
  const lookup = await lookupInviteToken(context, rawToken);
  if (!lookup.ok) {
    return { state: "invalid" as const, token: "", reason: lookup.reason, email: "" };
  }
  // Show the recipient their email so they know what they're accepting.
  const db = getPrisma(context);
  const user = await db.user.findUnique({
    where: { id: lookup.userId },
    select: { email: true },
  });
  return {
    state: "valid" as const,
    token: rawToken,
    email: user?.email ?? "",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  // Rate limit by IP — invite acceptance is a credential write path.
  const clientIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "accept-invite:" + clientIp,
  });
  if (!rl.ok) {
    return data(
      { error: "Too many attempts. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const formData = await request.formData();
  const parsed = actionSchema.safeParse(formData);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((i) => i.path[0] === "password");
    return data(
      {
        error: passwordIssue
          ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : "Please fill in both fields.",
      },
      { status: 400 },
    );
  }
  const { token, password, confirm } = parsed.data;
  if (password !== confirm) {
    return data({ error: "Passwords do not match." }, { status: 400 });
  }

  // Consume the invite token first — once consumed it cannot be reused
  // even if the password write below fails. This is intentional: the
  // narrow window where a token-consumed-but-password-not-set state
  // exists is contained to a single request, and the user can request
  // a fresh invite from staff.
  const consumed = await consumeInviteToken(context, token);
  if (!consumed.ok) {
    return data(
      { error: messageForReason(consumed.reason) },
      { status: 400 },
    );
  }

  const db = getPrisma(context);
  const user = await db.user.findUnique({
    where: { id: consumed.userId },
    select: { id: true, email: true, role: true, orgId: true, districtId: true },
  });
  if (!user) {
    return data({ error: "Invite is no longer valid." }, { status: 400 });
  }

  // Update the credential Account row's password hash. The row was
  // created by inviteUser via better-auth signUpEmail with a random
  // password we never told anyone — overwriting it now makes the
  // account usable for the first time.
  const hashed = await hashPassword(password);
  const account = await db.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!account) {
    return data(
      { error: "Could not finish setup — no credential account on file. Ask staff to re-invite you." },
      { status: 400 },
    );
  }
  await db.account.update({
    where: { id: account.id },
    data: { password: hashed },
  });
  await db.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false },
  });
  // Drop any sessions the random password may have produced (defense in
  // depth — there shouldn't be any, but belt-and-suspenders).
  await db.session.deleteMany({ where: { userId: user.id } });

  // Sign the user in. `returnHeaders: true` gives us Set-Cookie headers
  // we forward on the redirect so the browser ends up logged in.
  const auth = getAuth(context);
  let signin: { headers: Headers };
  try {
    signin = await auth.api.signInEmail({
      body: { email: user.email, password },
      returnHeaders: true,
    });
  } catch {
    // Sign-in failure here would be surprising — the password was just
    // written successfully. Fall back to /login so the user can sign
    // in manually rather than getting stuck on an error page.
    throw redirect("/login");
  }

  const headers = new Headers();
  for (const cookie of signin.headers.getSetCookie?.() ?? []) {
    headers.append("set-cookie", cookie);
  }
  headers.set("location", landingUrlFor(user));
  return new Response(null, { status: 302, headers });
}

function landingUrlFor(user: {
  role: string;
  orgId: string | null;
  districtId: string | null;
}): string {
  if (user.role === "PLATFORM_ADMIN") return "/platform";
  if (user.districtId) return "/district";
  if (user.orgId) return "/admin";
  return "/";
}

function messageForReason(reason: "not-found" | "used" | "expired" | "revoked"): string {
  switch (reason) {
    case "expired":
      return "This invite has expired. Ask staff to send a new one.";
    case "used":
      return "This invite has already been used. Try logging in.";
    case "revoked":
      return "This invite was revoked. Ask staff to send a new one.";
    case "not-found":
    default:
      return "This invite link is not valid.";
  }
}

export default function AcceptInvite({
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
            <h1 className="text-2xl font-bold">This invite isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-white/65">
              The link may have expired, been used already, or been revoked. Ask
              the person who invited you to send a new one.
            </p>
            <div className="mt-6">
              <Link
                to="/login"
                className="inline-flex items-center rounded-xl bg-[#E9D500] px-4 py-2 text-sm font-semibold text-[#193B4B] hover:brightness-95"
              >
                Go to sign in
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
          <h1 className="text-2xl font-bold">Set your password</h1>
          <p className="mt-2 text-sm text-white/65">
            Choose a password (at least {MIN_PASSWORD_LENGTH} characters) to
            finish creating your account.
          </p>
          {loaderData.email ? (
            <p className="mt-2 text-sm text-white/55">
              Signing in as <span className="font-mono text-white/80">{loaderData.email}</span>
            </p>
          ) : null}

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
              autoFocus
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
            {actionData?.error ? (
              <p className="text-center text-sm text-red-400">{actionData.error}</p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
            >
              Set password and sign in
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
