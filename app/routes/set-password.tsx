import { Button, Input } from "@heroui/react";
import { redirect } from "react-router";
import { hashPassword } from "~/domain/auth/better-auth.server";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { Route } from "./+types/set-password";
import { useState } from "react";

export function meta() {
  return [{ title: "Set password — Pickup Roster" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw redirect("/login");
  if (!user.mustChangePassword) throw redirect("/");
  return { email: user.email };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user) throw redirect("/login");

  const formData = await request.formData();
  const newPassword = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!newPassword || newPassword.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (newPassword !== confirm) {
    return { error: "Passwords do not match." };
  }

  const prisma = getPrisma(context);
  const hashed = await hashPassword(newPassword);

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!account) return { error: "No credential account found." };

  await prisma.account.update({
    where: { id: account.id },
    data: { password: hashed },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false },
  });

  throw redirect("/");
}

export default function SetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const { email } = loaderData;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#212525]">
      <p className="text-2xl font-bold text-white mb-1">Pickup Roster</p>
      <p className="text-lg font-semibold text-white mb-2">Welcome!</p>
      <p className="text-sm text-white/60 mb-6">Please set a password to continue.</p>

      <form method="post" className="flex flex-col gap-3 w-full max-w-sm px-4">
        <p className="text-white/50 text-sm text-center">{email}</p>
        <label className="text-sm text-gray-400">New Password</label>
        <Input
          type="password"
          name="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          placeholder="At least 8 characters"
        />
        <label className="text-sm text-gray-400">Confirm Password</label>
        <Input
          type="password"
          name="confirm"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        {actionData?.error && (
          <p className="text-red-400 text-sm text-center">{actionData.error}</p>
        )}
        <Button type="submit" variant="primary">
          Set Password
        </Button>
      </form>
    </div>
  );
}
