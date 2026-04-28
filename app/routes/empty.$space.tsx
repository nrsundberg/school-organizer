import type { Route } from "./+types/empty.$space";
import { redirect } from "react-router";
import {
  getOptionalUserFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { broadcastSpaceUpdate } from "~/lib/broadcast.server";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  // Mirror the gate on /update/:space — clearing a space is the same kind
  // of dismissal-state mutation as calling one, so it requires CONTROLLER
  // (admins are excluded). Throws Response 401/403 (not a UI redirect) so
  // the fetcher submission surfaces a real failure to the caller.
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Not authenticated", { status: 401 });
  if (user.role !== "CONTROLLER") throw new Response("Forbidden", { status: 403 });

  const spaceNumber = parseInt(space);
  const env = (context as { cloudflare?: { env: Env } }).cloudflare?.env;
  const cfCtx = (context as { cloudflare?: { ctx?: ExecutionContext } })
    .cloudflare?.ctx;

  const org = getOrgFromContext(context);

  // Tenant-scoped Prisma — auto-injects orgId via the tenant extension.
  const prisma = getTenantPrisma(context);

  // Previously this lived inside the BINGO_BOARD DO and serialized behind
  // every other tenant click. Doing it directly via Prisma drops the
  // single-threaded DO from the critical write path.
  await prisma.space.update({
    where: { orgId_spaceNumber: { orgId: org.id, spaceNumber } },
    data: { status: "EMPTY", timestamp: null },
  });

  const fanOut = (label: string, task: () => Promise<unknown>) => {
    const safe = (async () => {
      try {
        await task();
      } catch (err) {
        console.warn(`[empty.$space] broadcast ${label} failed`, err);
      }
    })();
    if (cfCtx && typeof cfCtx.waitUntil === "function") {
      cfCtx.waitUntil(safe);
    } else {
      return safe;
    }
  };

  if (env) {
    fanOut("spaceUpdate", () =>
      broadcastSpaceUpdate(env, org.id, spaceNumber, "EMPTY", null),
    );
  }

  return new Response("OK");
}
