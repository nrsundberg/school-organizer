import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  type MiddlewareFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError
} from "react-router";
import { useEffect } from "react";
import { getToast } from "remix-toast";
import { toast as notify, ToastContainer } from "react-toastify";
import toastStyles from "react-toastify/ReactToastify.css?url";
import styles from "./app.css?url";
import type { Route } from "./+types/root";
import {
  globalStorageMiddleware,
  userContext,
  getOptionalOrgFromContext,
} from "~/domain/utils/global-context.server";
import { isMarketingHost } from "~/domain/utils/host.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { ImpersonationBanner } from "~/components/ImpersonationBanner";
import logo from "/favicon.ico?url";
import { getBrandingFromOrg } from "~/domain/org/branding.server";
import { DEFAULT_SITE_NAME } from "~/lib/site";

export const middleware: MiddlewareFunction<Response>[] = [
  globalStorageMiddleware
];

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data) {
    return [
      { title: DEFAULT_SITE_NAME },
      { name: "description", content: "Live car line board, viewer access, and school admin tools." },
    ];
  }
  if (data.marketing) {
    return [
      { title: `${DEFAULT_SITE_NAME} — Car line made clear` },
      { name: "description", content: "Live car line board, viewer access, and school admin tools." },
    ];
  }
  const name = data.branding?.orgName ?? DEFAULT_SITE_NAME;
  return [
    { title: `${name} — Car line` },
    { name: "description", content: `${name} car line board.` },
  ];
};

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: toastStyles }
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = context.get(userContext) ?? null;
  const org = getOptionalOrgFromContext(context);
  const marketing = isMarketingHost(request, context);
  const { toast, headers } = await getToast(request);

  let impersonatedBy: string | null = null;
  if (user) {
    try {
      const auth = getAuth(context);
      const session = await auth.api.getSession({ headers: request.headers });
      impersonatedBy = (session?.session as any)?.impersonatedBy ?? null;
    } catch {
      // ignore
    }
  }

  return data(
    { toast, user, impersonatedBy, branding: getBrandingFromOrg(org), marketing },
    { headers },
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please try again.";
  let statusCode: number | null = null;

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 401) {
      title = "Not Logged In";
      message = "You need to be logged in to access this page.";
    } else if (error.status === 403) {
      title = "Access Denied";
      message = "You don't have permission to view this page.";
    } else if (error.status === 404) {
      title = "Page Not Found";
      message = "The page you're looking for doesn't exist.";
    } else {
      message = error.statusText || message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <html lang="en" className="dark bg-[#212525]">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error — School Organizer</title>
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-[#212525] text-white flex flex-col">
        <div className="h-10 w-full bg-blue-300 flex items-center justify-center flex-shrink-0 relative">
          <a href="/" className="text-black font-bold inline-flex items-center">
            <img src={logo} alt="school logo" height={40} width={40} />
            School Organizer — Car line
          </a>
          <a
            href="/login"
            className="border border-black p-1 rounded-lg absolute right-2 text-black text-sm"
          >
            Login
          </a>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          {statusCode && (
            <p className="text-blue-300 text-6xl font-bold mb-2">{statusCode}</p>
          )}
          <h1 className="text-2xl font-semibold mb-3">{title}</h1>
          <p className="text-white/60 mb-6 text-center max-w-sm">{message}</p>
          <a
            href="/"
            className="bg-blue-300 text-black font-semibold px-4 py-2 rounded-lg hover:bg-blue-400 transition-colors"
          >
            Go Home
          </a>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { toast, user, impersonatedBy, branding } = loaderData;

  useEffect(() => {
    if (toast) {
      notify(toast.message, { type: toast.type, theme: "dark" });
    }
  }, [toast]);

  return (
    <html lang="en" className="dark bg-[#212525]">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Loading...</title>
        <Meta />
        <Links />
      </head>
      <body
        style={
          {
            ["--brand-primary" as string]: branding.primaryColor,
            ["--brand-accent" as string]: branding.accentColor,
          }
        }
      >
        {impersonatedBy && user && (
          <ImpersonationBanner userName={user.name || user.email} />
        )}
        <ToastContainer />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
