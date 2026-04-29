/**
 * Pure path classification for the request-scope resolver.
 *
 * Each flag is a yes/no answer about how the resolver should treat this URL.
 * Kept as a flat record of booleans so the caller can pattern-match on the
 * combinations that matter (e.g. "anonymous + isPublicMarketingPath = OK").
 */
export type RequestPathClassification = {
  /** True for /assets/*, /build/*, and /favicon.ico — never gated. */
  isStatic: boolean;
  /** True for /set-password (the mustChangePassword detour). */
  isSetPassword: boolean;
  /** True for /api/*. */
  isApi: boolean;
  /** True for /logout. */
  isLogout: boolean;
  /** True for /login, /forgot-password, /reset-password, /viewer-access. */
  isAuthFlow: boolean;
  /** True for /api/auth/*. */
  isAuthApi: boolean;
  /** True for /api/onboarding. */
  isOnboardingApi: boolean;
  /** True for /api/webhooks/stripe. */
  isStripeWebhook: boolean;
  /** True for /api/check-email, /api/check-org-slug, /api/branding/logo/*, /api/healthz. */
  isPublicApi: boolean;
  /** True for /platform/*. */
  isPlatform: boolean;
  /** True for /billing-required. */
  isBillingRequired: boolean;

  /** Anonymous requests don't need viewer-access checks for these paths. */
  anonSkipsViewer: boolean;
  /** Tenant ↔ org match check is skipped for these paths. */
  skipTenantOrgBinding: boolean;
  /** Billing-required redirect is skipped for these paths. */
  exemptFromBillingGate: boolean;
  /** Marketing paths that are publicly viewable without auth (host-aware). */
  isPublicMarketingPath: boolean;
};

export function classifyRequestPath(
  pathname: string,
  onMarketingHost: boolean,
): RequestPathClassification {
  const isSetPassword = pathname === "/set-password";
  const isApi = pathname.startsWith("/api/");
  const isLogout = pathname === "/logout";
  const isLogin = pathname === "/login";
  const isForgotPassword = pathname === "/forgot-password";
  const isResetPassword = pathname === "/reset-password";
  const isViewerAccess = pathname === "/viewer-access";
  const isBillingRequired = pathname === "/billing-required";
  const isOnboardingApi = pathname === "/api/onboarding";
  const isStripeWebhook = pathname === "/api/webhooks/stripe";
  const isAuthApi = pathname.startsWith("/api/auth/");
  const isStatic =
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/build/") ||
    pathname === "/favicon.ico";
  const isCheckEmailApi = pathname === "/api/check-email";
  const isCheckOrgSlugApi = pathname === "/api/check-org-slug";
  const isBrandingLogoApi = pathname.startsWith("/api/branding/logo/");
  const isHealthz = pathname === "/api/healthz";
  const isPlatform = pathname.startsWith("/platform");

  const isPublicApi =
    isCheckEmailApi || isCheckOrgSlugApi || isBrandingLogoApi || isHealthz;

  const isAuthFlow =
    isLogin || isForgotPassword || isResetPassword || isViewerAccess;

  const isPublicMarketingPath =
    pathname === "/pricing" ||
    pathname === "/faqs" ||
    pathname === "/status" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/guides" ||
    pathname.startsWith("/guides/") ||
    (pathname === "/signup" && onMarketingHost) ||
    (pathname === "/district/signup" && onMarketingHost) ||
    (pathname.startsWith("/api/onboarding") && onMarketingHost) ||
    (pathname === "/" && onMarketingHost);

  const anonSkipsViewer =
    isLogin ||
    isLogout ||
    isForgotPassword ||
    isResetPassword ||
    isViewerAccess ||
    isAuthApi ||
    isStatic ||
    isPublicApi ||
    isPublicMarketingPath;

  const skipTenantOrgBinding = isStatic || isAuthApi || isStripeWebhook || isLogout;

  const exemptFromBillingGate =
    isBillingRequired ||
    isOnboardingApi ||
    isStripeWebhook ||
    isAuthApi ||
    isStatic;

  return {
    isStatic,
    isSetPassword,
    isApi,
    isLogout,
    isAuthFlow,
    isAuthApi,
    isOnboardingApi,
    isStripeWebhook,
    isPublicApi,
    isPlatform,
    isBillingRequired,
    anonSkipsViewer,
    skipTenantOrgBinding,
    exemptFromBillingGate,
    isPublicMarketingPath,
  };
}
