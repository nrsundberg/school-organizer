import { Button, Input } from "@heroui/react";
import { redirect } from "react-router";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import type { Route } from "./+types/login";
import { useState } from "react";
import { signIn } from "~/lib/auth-client";
import { Page } from "~/components/Page";

export function meta() {
  return [
    { title: "Login - Tome Car Bingo" },
    { name: "description", content: "Sign in to Tome School car line" }
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  return null;
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
        window.location.href = "/";
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <Page user={false}>
      <div className="h-[calc(100vh-40px)] flex flex-col items-center justify-center bg-[#212525]">
        <p className="text-2xl font-bold text-white mb-1">Tome School</p>
        <p className="text-lg font-semibold text-white mb-6">Car Line Bingo</p>

        {step === "email" ? (
          <form
            onSubmit={handleEmailNext}
            className="flex flex-col gap-3 w-full max-w-sm px-4"
          >
            <label htmlFor={"email"}>Email Address</label>
            <Input
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <Button type="submit" isPending={loading} variant="primary">
              Next
            </Button>
          </form>
        ) : (
          <form
            onSubmit={handleLogin}
            className="flex flex-col gap-3 w-full max-w-sm px-4"
          >
            <p className="text-white text-sm text-center">{email}</p>
            <label className="text-sm text-gray-400">Password</label>
            <Input
              type="password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <Button type="submit" isPending={loading} variant="primary">
              Sign In
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
                setPassword("");
              }}
              className="text-sm text-gray-400 hover:text-white text-center"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </Page>
  );
}
