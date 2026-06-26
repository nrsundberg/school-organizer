import { data } from "react-router";
import type { Route } from "./+types/check-email";
import { getPrisma } from "~/db.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";

export async function action({ request, context }: Route.ActionArgs) {
  // This endpoint reveals whether an email is registered (account-enumeration
  // oracle). Throttle by IP with the shared auth limiter so it can't be used
  // to harvest valid accounts in bulk.
  const rl = await checkRateLimit({
    limiter: getRateLimiter(context, "RL_AUTH"),
    key: "check-email:" + clientIpFromRequest(request),
  });
  if (!rl.ok) {
    return data(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let email: string;
  try {
    ({ email } = await request.json() as { email: string });
  } catch {
    return data({ error: "Invalid request" }, { status: 400 });
  }

  if (!email) {
    return data({ error: "Email required" }, { status: 400 });
  }

  const db = getPrisma(context);
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });

  return data({ exists: !!user });
}
