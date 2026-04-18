import { Button, Input } from "@heroui/react";
import { data, Form, redirect, useNavigation } from "react-router";
import { dataWithError } from "remix-toast";
import type { Route } from "./+types/viewer-access";
import {
  consumeViewerMagicLink,
  getViewerLockState,
  verifyViewerPinAndIssueSession,
} from "~/domain/auth/viewer-access.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export function meta() {
  return [{ title: "Viewer Access - Tome Car Bingo" }];
}

function safeRedirect(next: string | null): string {
  if (!next || !next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/viewer-access")) return "/";
  return next;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  const url = new URL(request.url);
  const next = safeRedirect(url.searchParams.get("next"));
  const token = url.searchParams.get("token");

  if (token) {
    const consumed = await consumeViewerMagicLink({ request, context }, token);
    if (consumed.ok) {
      throw redirect(next, { headers: consumed.headers });
    }
    return data({ next, lockMessage: null, tokenError: consumed.message });
  }

  const lock = await getViewerLockState({ request, context });
  return data({ next, lockMessage: lock.message, tokenError: null }, { headers: lock.setCookie ? { "Set-Cookie": lock.setCookie } : undefined });
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const pin = String(formData.get("pin") ?? "").trim();
  const next = safeRedirect(String(formData.get("next") ?? "/"));
  if (!pin) {
    return dataWithError({ fieldError: "Access code is required.", next }, "Invalid access code.");
  }

  const result = await verifyViewerPinAndIssueSession({ request, context }, pin);
  if (!result.ok) {
    return dataWithError({ fieldError: result.message, next }, result.message, { headers: result.headers });
  }
  throw redirect(next, { headers: result.headers });
}

export default function ViewerAccess({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const isBusy = nav.state !== "idle";
  const fieldError = (actionData as any)?.fieldError ?? loaderData.tokenError ?? loaderData.lockMessage;

  return (
    <div className="min-h-screen bg-[#212525] text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1f1f] p-6">
        <h1 className="text-2xl font-bold mb-2">Private Viewer Access</h1>
        <p className="text-white/60 text-sm mb-5">
          Enter the shared access code from your school administrator.
        </p>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="next" value={loaderData.next} />
          <Input
            name="pin"
            type="password"
            placeholder="Access code"
            autoFocus
            autoComplete="off"
          />
          {fieldError ? <p className="text-sm text-red-400">{fieldError}</p> : null}
          <Button type="submit" variant="primary" isPending={isBusy} className="w-full">
            Continue
          </Button>
        </Form>
      </div>
    </div>
  );
}
