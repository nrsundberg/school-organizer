import type { Route } from "./+types/update.$space";
import { redirect } from "react-router";
import { assertTrialAllowsNewPickup } from "~/domain/billing/trial-enforcement.server";
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  broadcastCallEvent,
  broadcastSpaceUpdate,
} from "~/lib/broadcast.server";

export async function action({ params, context }: Route.ActionArgs) {
  const { space } = params;
  if (space === undefined) {
    throw redirect("/");
  }

  // Spot-call is privileged: only signed-in CONTROLLER users (or someone
  // impersonating a controller via better-auth) may record dismissals.
  // ADMINs are intentionally excluded — managing the roster ≠ running it.
  // Throws 401/403 (Response, not redirect) so the fetcher submission
  // surfaces a real failure rather than a silent UI bounce.
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Not authenticated", { status: 401 });
  if (user.role !== "CONTROLLER") throw new Response("Forbidden", { status: 403 });

  const org = getOrgFromContext(context);

  // Enforce trial expiration for FREE orgs before recording a pickup event.
  await assertTrialAllowsNewPickup(context, org.id);

  const spaceNumber = parseInt(space);
  const timestamp = new Date().toISOString();
  const env = (context as { cloudflare?: { env: Env } }).cloudflare?.env;
  const cfCtx = (context as { cloudflare?: { ctx?: ExecutionContext } })
    .cloudflare?.ctx;

  const { actorUserId, onBehalfOfUserId } = getActorIdsFromContext(context);

  // Tenant-scoped Prisma — auto-injects orgId via the tenant extension so
  // both writes and the student lookup stay inside this tenant.
  const prisma = getTenantPrisma(context);

  // Space update + roster lookup are independent — run them in parallel.
  // The CallEvent insert depends on the student row, so it follows.
  // Previously these three queries lived inside the BINGO_BOARD DO, which
  // serialized every tenant's clicks behind a single-threaded queue and
  // hit Cloudflare's wall-clock under rapid clicking.
  const [, student] = await Promise.all([
    prisma.space.update({
      where: { orgId_spaceNumber: { orgId: org.id, spaceNumber } },
      data: { status: "ACTIVE", timestamp },
    }),
    prisma.student.findFirst({
      where: { spaceNumber },
      select: { id: true, firstName: true, lastName: true, homeRoom: true },
    }),
  ]);

  const studentName = student
    ? `${student.firstName} ${student.lastName}`
    : `Space ${spaceNumber}`;

  const event = await prisma.callEvent.create({
    data: {
      spaceNumber,
      studentId: student?.id ?? null,
      studentName,
      homeRoomSnapshot: student?.homeRoom ?? null,
      actorUserId: actorUserId ?? null,
      onBehalfOfUserId: onBehalfOfUserId ?? null,
    },
    select: {
      id: true,
      orgId: true,
      spaceNumber: true,
      studentId: true,
      studentName: true,
      homeRoomSnapshot: true,
      actorUserId: true,
      onBehalfOfUserId: true,
      createdAt: true,
    },
  });

  // Fire-and-forget broadcast dispatch — same pattern as the drills.live
  // fix. A broadcast failure must not 500 a click whose DB write already
  // succeeded; WS reconnect resync covers any client that missed the
  // message.
  const fanOut = (label: string, task: () => Promise<unknown>) => {
    const safe = (async () => {
      try {
        await task();
      } catch (err) {
        console.warn(`[update.$space] broadcast ${label} failed`, err);
      }
    })();
    if (cfCtx && typeof cfCtx.waitUntil === "function") {
      cfCtx.waitUntil(safe);
    } else {
      // Test / non-Workers path: keep the await so tests can observe.
      return safe;
    }
  };

  if (env) {
    fanOut("spaceUpdate", () =>
      broadcastSpaceUpdate(env, org.id, spaceNumber, "ACTIVE", timestamp),
    );
    fanOut("callEvent", () => broadcastCallEvent(env, org.id, event));
  }

  return new Response("OK");
}
