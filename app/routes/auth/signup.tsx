import { Button, Input } from "@heroui/react";
import { redirect } from "react-router";
import type { Route } from "./+types/signup";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { signUp } from "~/lib/auth-client";
import { useState, type FormEvent } from "react";

export function meta() {
  return [
    { title: "Signup — School Organizer" },
    { name: "description", content: "Create your organization and account" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  return null;
}

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<"FREE" | "STARTER">("FREE");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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

      const orgRes = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName,
          slug,
          plan,
        }),
      });
      const payload = (await orgRes.json()) as { error?: string };
      if (!orgRes.ok) {
        setError(payload.error ?? "Unable to create organization.");
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page user={false}>
      <div className="h-[calc(100vh-40px)] flex flex-col items-center justify-center bg-[#212525]">
        <p className="text-2xl font-bold text-white mb-1">Create your account</p>
        <p className="text-sm text-white/70 mb-6">
          Start on free and upgrade to paid billing anytime.
        </p>

        <form onSubmit={handleSignup} className="flex flex-col gap-3 w-full max-w-sm px-4">
          <Input type="text" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" placeholder="Choose a password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input type="text" placeholder="Organization name" required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          <Input type="text" placeholder="Organization slug (optional)" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <label className="text-sm text-white/80">
            Plan
            <select
              className="mt-1 w-full rounded-md border border-white/20 bg-[#1f2424] px-2 py-2 text-white"
              value={plan}
              onChange={(e) => setPlan(e.target.value === "STARTER" ? "STARTER" : "FREE")}
            >
              <option value="FREE">Free</option>
              <option value="STARTER">Starter (Stripe)</option>
            </select>
          </label>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <Button type="submit" isPending={loading} variant="primary">
            Create account
          </Button>
        </form>
      </div>
    </Page>
  );
}
