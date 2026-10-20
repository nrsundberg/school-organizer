/**
 * Where a signed-in visitor should go instead of the marketing sign-up
 * or login form.
 *
 * Users have one school (`User.orgId`). There is no org picker. A district
 * admin's active school, when they are impersonating one, is the session's
 * `impersonatedOrgId` — the caller passes that as `boardUrl`.
 *
 * A `next` or `redirect` query param is followed only when it stays on this
 * site. Auth pages are skipped so /login and /signup cannot bounce forever.
 */

const AUTH_ENTRY_PREFIXES = [
  "/login",
  "/signup",
  "/district/signup",
  "/forgot-password",
  "/reset-password",
  "/logout",
];

export type SignedInHome = "platform" | "board" | "district" | "onboarding";

export function signedInHome(
  user: { orgId: string | null; districtId?: string | null },
  opts: { isPlatformStaff: boolean; hasBoard: boolean },
): SignedInHome {
  if (opts.isPlatformStaff) return "platform";
  // `hasBoard` is the caller's active school: User.orgId, or the session's
  // impersonated org when a district admin is inside a school.
  if (opts.hasBoard) return "board";
  if (user.districtId) return "district";
  return "onboarding";
}

export function onboardingSignupPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  const params = new URLSearchParams();
  params.set("step", "2");
  const plan = url.searchParams.get("plan")?.trim() ?? "";
  if (plan && plan.toLowerCase() !== "district") params.set("plan", plan);
  const cycle = url.searchParams.get("cycle")?.trim() ?? "";
  if (cycle) params.set("cycle", cycle);
  return `/signup?${params.toString()}`;
}

export function isCreateSchoolStep(requestUrl: string): boolean {
  const url = new URL(requestUrl);
  if (url.pathname !== "/signup") return false;
  const step = Number(url.searchParams.get("step"));
  return step === 2 || step === 3;
}

export function safeSameSiteTarget(
  raw: string | null,
  requestUrl: string,
  rootDomain: string,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000\r\n\\]/.test(trimmed)) return null;
  if (/%5c|%00|%0d|%0a/i.test(trimmed)) return null;

  let url: URL;
  try {
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      url = new URL(trimmed, requestUrl);
    } else {
      url = new URL(trimmed);
    }
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (pathIsOpenRedirect(url.pathname)) return null;

  const request = new URL(requestUrl);
  if (!isSameSiteHost(url.hostname, request.hostname, rootDomain)) return null;
  if (isAuthEntry(url.pathname)) return null;

  if (url.host === request.host) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

export function authPageRedirectTarget(args: {
  page: "login" | "signup" | "district-signup";
  requestUrl: string;
  home: SignedInHome;
  boardUrl: string | null;
  next: string | null;
  onboardingPath: string;
  marketingOrigin: string;
  onMarketingHost: boolean;
}): string | null {
  if (args.next && !sameLocation(args.next, args.requestUrl)) {
    return args.next;
  }

  if (args.page === "district-signup" && args.home === "onboarding") {
    return null;
  }
  if (
    args.page === "signup" &&
    args.home === "onboarding" &&
    isCreateSchoolStep(args.requestUrl)
  ) {
    return null;
  }

  const target = homeUrl(args);
  if (!target || sameLocation(target, args.requestUrl)) return null;
  return target;
}

function homeUrl(args: {
  home: SignedInHome;
  boardUrl: string | null;
  onboardingPath: string;
  marketingOrigin: string;
  onMarketingHost: boolean;
}): string | null {
  const here = (path: string) =>
    args.onMarketingHost ? path : `${args.marketingOrigin}${path}`;
  if (args.home === "platform") return here("/platform");
  if (args.home === "board") return args.boardUrl;
  if (args.home === "district") return here("/district");
  return here(args.onboardingPath);
}

function pathIsOpenRedirect(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("//");
}

function isAuthEntry(pathname: string): boolean {
  return AUTH_ENTRY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isSameSiteHost(hostname: string, requestHostname: string, rootDomain: string): boolean {
  const host = hostname.toLowerCase();
  const req = requestHostname.toLowerCase();
  if (host === req) return true;
  const root = rootDomain.trim().toLowerCase();
  if (root && root !== "localhost" && !root.endsWith(".localhost")) {
    if (host === root || host === `www.${root}` || host.endsWith(`.${root}`)) return true;
  }
  const local = (value: string) => value === "localhost" || value.endsWith(".localhost");
  return local(host) && local(req);
}

function sameLocation(target: string, requestUrl: string): boolean {
  const current = new URL(requestUrl);
  const resolved = new URL(target, requestUrl);
  return (
    resolved.origin === current.origin &&
    resolved.pathname === current.pathname &&
    resolved.search === current.search
  );
}
