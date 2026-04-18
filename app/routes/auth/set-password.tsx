import { Button, Input } from "@heroui/react";
import { redirect, useSearchParams } from "react-router";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
// @ts-expect-error - route types not yet generated
import type { Route } from "./+types/set-password";
import { useState } from "react";
import { signIn, authClient } from "~/lib/auth-client";

export function meta() {
  return [
    { title: "Set Password - Tome Car Bingo" },
    { name: "description", content: "Set your password for Tome School car line" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  return null;
}

export default function SetPassword() {
  const [searchParams] = useSearchParams();
  const emailFromParams = searchParams.get("email") ?? "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      // Sign in with the temporary password first
      const signInResult = await signIn.email({
        email: emailFromParams,
        password: currentPassword,
      });

      if (signInResult.error) {
        setError("Temporary password is incorrect.");
        setLoading(false);
        return;
      }

      // Now change to the new password
      const changeResult = await authClient.changePassword({
        currentPassword,
        newPassword,
      });

      if (changeResult.error) {
        setError("Failed to set new password. Please try again.");
        setLoading(false);
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#212525]">
      <p className="text-2xl font-bold text-white mb-1">Tome School</p>
      <p className="text-lg font-semibold text-white mb-2">Car Line Bingo</p>
      <p className="text-sm text-gray-400 mb-6">Set your new password</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-sm px-4">
        <label className="text-sm text-gray-400">Temporary password</label>
        <Input
          type="password"
          placeholder="Enter your temporary password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        <label className="text-sm text-gray-400">New password</label>
        <Input
          type="password"
          placeholder="At least 8 characters"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <label className="text-sm text-gray-400">Confirm new password</label>
        <Input
          type="password"
          placeholder="Re-enter your new password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
        <Button type="submit" isPending={loading} variant="primary">
          Set Password
        </Button>
      </form>
    </div>
  );
}
