import { Button, Input } from "@heroui/react";
import { data, Form, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { dataWithError } from "remix-toast";
import type { Route } from "./+types/viewer-access";
import {
  consumeViewerMagicLink,
  getViewerLockState,
  verifyViewerPinAndIssueSession,
} from "~/domain/auth/viewer-access.server";
import {
  getOptionalOrgFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";
import Header from "~/components/Header";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["auth"] };

type RootBranding = {
  orgName?: string;
  primaryColor?: string;
  logoUrl?: string | null;
};

export function meta({ data }: { data?: { metaTitle?: string } }) {
  return [{ title: data?.metaTitle ?? "Viewer access — Pickup Roster" }];
}

function safeRedirect(next: string | null): string {
  if (!next || !next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/viewer-access")) return "/";
  return next;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const org = getOptionalOrgFromContext(context);
  if (!org) throw redirect("/");

  const user = getOptionalUserFromContext(context);
  if (user) throw redirect("/");
  const url = new URL(request.url);
  const next = safeRedirect(url.searchParams.get("next"));
  const token = url.searchParams.get("token");

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");
  const metaTitle = t("viewerAccess.metaTitle");

  if (token) {
    const consumed = await consumeViewerMagicLink({ request, context }, token);
    if (consumed.ok) {
      throw redirect(next, { headers: consumed.headers });
    }
    return data({ next, lockMessage: null, tokenError: consumed.message, metaTitle });
  }

  const lock = await getViewerLockState({ request, context });
  return data(
    { next, lockMessage: lock.message, tokenError: null, metaTitle },
    { headers: lock.setCookie ? { "Set-Cookie": lock.setCookie } : undefined },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const org = getOptionalOrgFromContext(context);
  if (!org) throw redirect("/");

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "auth");

  const formData = await request.formData();
  const pin = String(formData.get("pin") ?? "").trim();
  const next = safeRedirect(String(formData.get("next") ?? "/"));
  if (!pin) {
    return dataWithError(
      { fieldError: t("viewerAccess.errors.pinRequired"), next },
      t("viewerAccess.errors.invalid"),
    );
  }

  const result = await verifyViewerPinAndIssueSession({ request, context }, pin);
  if (!result.ok) {
    return dataWithError({ fieldError: result.message, next }, result.message, { headers: result.headers });
  }
  throw redirect(next, { headers: result.headers });
}

export default function ViewerAccess({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("auth");
  const nav = useNavigation();
  const isBusy = nav.state !== "idle";
  const fieldError = (actionData as any)?.fieldError ?? loaderData.tokenError ?? loaderData.lockMessage;

  // Pull tenant branding from the root loader so the header carries the
  // school's logo + primary color. `useRouteLoaderData` returns undefined
  // before hydration on some flows; `?.branding` keeps that safe.
  const rootData = useRouteLoaderData("root") as { branding?: RootBranding } | undefined;

  return (
    // The loader bounces authed users to "/", so this page only renders
    // for signed-out visitors. user={false} on the Header surfaces the
    // "Login" link in the top-right — that's the whole point of this fix:
    // staff members on a tenant subdomain shouldn't be stuck at the
    // viewer access prompt with no way to reach /login.
    <div className="min-h-screen bg-[#212525] text-white flex flex-col">
      <Header user={false} branding={rootData?.branding} />
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1f1f] p-6">
          <h1 className="text-2xl font-bold mb-2">{t("viewerAccess.title")}</h1>
          <p className="text-white/60 text-sm mb-5">
            {t("viewerAccess.subtitle")}
          </p>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="next" value={loaderData.next} />
            <Input
              name="pin"
              type="password"
              placeholder={t("viewerAccess.pinPlaceholder")}
              autoFocus
              autoComplete="off"
            />
            {fieldError ? <p className="text-sm text-red-400">{fieldError}</p> : null}
            <Button type="submit" variant="primary" isPending={isBusy} className="w-full">
              {t("viewerAccess.submit")}
            </Button>
          </Form>
          {/*
            Inline backup link in case the user misses the Login button in
            the header. Staff with real accounts (controllers, admins) need
            an obvious way out of the viewer prompt.
          */}
          <p className="mt-4 text-center text-xs text-white/40">
            {t("viewerAccess.staffPrompt")}{" "}
            <a href="/login" className="text-white/70 underline hover:text-white">
              {t("viewerAccess.staffSignIn")}
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
