import { useState } from "react";
import {
  isRouteErrorResponse,
  Outlet,
  useLoaderData,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { Menu, X, ShieldAlert, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/layout";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { buildUsageSnapshot, countOrgUsage } from "~/domain/billing/plan-usage.server";
import { addDaysUtc } from "~/domain/billing/trial.server";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import AdminSidebar from "~/components/admin/AdminSidebar";
import { AdminUsageBanner } from "~/components/admin/AdminUsageBanner";
import { PastDuePaymentBanner } from "~/components/admin/PastDuePaymentBanner";
import { TrialEndingBanner } from "~/components/admin/TrialEndingBanner";
import Header from "~/components/Header";
import logo from "/logo-icon.svg?url";

export const handle = { i18n: ["admin", "common"] };

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const counts = await countOrgUsage(prisma, org.id);
  const usage = buildUsageSnapshot(org, counts, new Date());

  const now = new Date();
  let pastDuePaymentBanner: { suspendOnIso: string } | null = null;
  if (
    org.pastDueSinceAt &&
    org.subscriptionStatus === "PAST_DUE" &&
    org.status !== "SUSPENDED" &&
    now < addDaysUtc(org.pastDueSinceAt, 7)
  ) {
    pastDuePaymentBanner = {
      suspendOnIso: addDaysUtc(org.pastDueSinceAt, 14).toISOString(),
    };
  }

  // Trial-ending nudge: only when the org is in trial, has no Stripe customer
  // yet (so they truly haven't paid), and the trial expires within 7 days.
  let trialEndingBanner:
    | { daysRemaining: number; billingPlan: "CAR_LINE" | "CAMPUS" }
    | null = null;
  if (
    org.status === "TRIALING" &&
    !org.stripeCustomerId &&
    org.trialEndsAt &&
    (org.billingPlan === "CAR_LINE" || org.billingPlan === "CAMPUS")
  ) {
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = Math.max(
      0,
      Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / msPerDay),
    );
    if (daysRemaining <= 7) {
      trialEndingBanner = { daysRemaining, billingPlan: org.billingPlan };
    }
  }

  return {
    usage,
    pastDuePaymentBanner,
    trialEndingBanner,
    compedUntil: org.compedUntil ? org.compedUntil.toISOString() : null,
    // Schools inside a district don't manage their own billing — hide the
    // sidebar Billing link.
    orgIsInDistrict: !!org.districtId,
  };
}

export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation("admin");

  const is401 =
    isRouteErrorResponse(error) && error.status === 401;
  const is403 =
    isRouteErrorResponse(error) && error.status === 403;

  if (is401 || is403) {
    const statusCode = isRouteErrorResponse(error) ? error.status : null;
    return (
      <div className="min-h-screen bg-[#212525] text-white flex flex-col">
        <div className="h-10 w-full bg-blue-300 flex items-center justify-center flex-shrink-0 relative">
          <a href="/" className="text-black font-bold inline-flex items-center">
            <img src={logo} alt={t("layout.errors.headerLogoAlt")} height={40} width={40} />
            {t("layout.errors.headerBrand")}
          </a>
          <a
            href="/login"
            className="border border-black p-1 rounded-lg absolute right-2 text-black text-sm"
          >
            {t("layout.errors.loginLink")}
          </a>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
          <div className="rounded-full bg-blue-300/10 p-5">
            {is401 ? (
              <LogIn className="w-10 h-10 text-blue-300" />
            ) : (
              <ShieldAlert className="w-10 h-10 text-blue-300" />
            )}
          </div>
          {statusCode && (
            <p className="text-blue-300 text-6xl font-bold">{statusCode}</p>
          )}
          <h1 className="text-2xl font-semibold">
            {is401 ? t("layout.errors.loginRequired") : t("layout.errors.accessDenied")}
          </h1>
          <p className="text-white/60 text-center max-w-sm">
            {is401
              ? t("layout.errors.loginRequiredBody")
              : t("layout.errors.accessDeniedBody")}
          </p>
          <div className="flex gap-3 mt-2">
            {is401 && (
              <a
                href="/login"
                className="bg-blue-300 text-black font-semibold px-4 py-2 rounded-lg hover:bg-blue-400 transition-colors"
              >
                {t("layout.errors.logIn")}
              </a>
            )}
            <a
              href="/"
              className="border border-white/20 text-white px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              {t("layout.errors.goHome")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Fall through to root error boundary for unexpected errors
  throw error;
}

export default function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const {
    usage,
    pastDuePaymentBanner,
    trialEndingBanner,
    compedUntil,
    orgIsInDistrict,
  } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation("admin");
  const isComped = !!compedUntil && new Date(compedUntil) > new Date();
  const rootData = useRouteLoaderData("root") as
    | { branding?: { orgName?: string; primaryColor?: string; logoUrl?: string | null } }
    | undefined;

  return (
    <div className="flex flex-col min-h-screen bg-[#212525] text-white">
      <Header user={true} branding={rootData?.branding} />
      {isComped && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-200 px-4 py-2 text-sm">
          {t("layout.compedThrough", {
            date: new Date(compedUntil!).toLocaleDateString(i18n.language, {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
          })}
        </div>
      )}
      {pastDuePaymentBanner && (
        <PastDuePaymentBanner suspendOnIso={pastDuePaymentBanner.suspendOnIso} />
      )}
      {trialEndingBanner && (
        <TrialEndingBanner
          daysRemaining={trialEndingBanner.daysRemaining}
          billingPlan={trialEndingBanner.billingPlan}
        />
      )}
      {usage.limits && <AdminUsageBanner usage={usage} />}
      <div className="flex flex-1">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen bg-[#1a1f1f] border-r border-white/10 flex-shrink-0">
        <AdminSidebar showBilling={!orgIsInDistrict} />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile hamburger header */}
        <div className="md:hidden flex items-center h-12 bg-[#1a1f1f] border-b border-white/10 px-3 flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/60 hover:text-white mr-2 p-1"
            aria-label={t("layout.openNav")}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-white tracking-wide">{t("layout.panelTitle")}</span>
        </div>

        {/* Mobile drawer overlay */}
        {drawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-[60] flex"
            onClick={() => setDrawerOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative w-64 h-full bg-[#1a1f1f] border-r border-white/10 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-sm font-semibold">{t("layout.panelTitle")}</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="text-white/60 hover:text-white p-1"
                  aria-label={t("layout.closeNav")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <AdminSidebar
                  onLinkClick={() => setDrawerOpen(false)}
                  showBilling={!orgIsInDistrict}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
