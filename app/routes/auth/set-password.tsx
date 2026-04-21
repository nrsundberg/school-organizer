import { Button, Input } from "@heroui/react";
import { Link, redirect, useSearchParams } from "react-router";
import { MarketingNav } from "~/components/marketing/MarketingNav";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
// @ts-expect-error - route types not yet generated
import type { Route } from "./+types/set-password";
import { useState } from "react";
import { signIn, authClient } from "~/lib/auth-client";

export function meta() {
  return [
    { title: "Set password — Pickup Roster" },
    { name: "description", content: "Set your password for your school car line" },
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
    <div className="min-h-screen bg-[#0f1414] text-white">
      <MarketingNav />

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#151a1a] p-6 shadow-xl">
          <h1 className="text-2xl font-bold">Set your password</h1>
          <p className="mt-2 text-sm text-white/65">
            Replace your temporary password with a new one you&apos;ll remember.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <label className="text-sm text-white/80">Temporary password</label>
            <Input
              type="password"
              placeholder="Enter your temporary password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <label className="text-sm text-white/80">New password</label>
            <Input
              type="password"
              placeholder="At least 8 characters"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <label className="text-sm text-white/80">Confirm new password</label>
            <Input
              type="password"
              placeholder="Re-enter your new password"
              required
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
              className="mt-1 bg-[#E9D500] font-semibold text-[#193B4B]"
            >
              Set password
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-white/55">
            <Link to="/login" className="font-medium text-[#E9D500] hover:underline">
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
