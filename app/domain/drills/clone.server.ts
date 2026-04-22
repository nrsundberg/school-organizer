// app/domain/drills/clone.server.ts
//
// Server-only helper for cloning a globally-seeded drill template into an
// org's own DrillTemplate table. Used by the library picker route action and
// (potentially) future bulk-clone tooling, so the create logic only lives in
// one place.

import type { PrismaClient } from "~/db";
import { getGlobalTemplate } from "./library";

/**
 * Clone a global library template (matched by `globalKey`) into an org's
 * `DrillTemplate` table.
 *
 * The template's `definition` is deep-cloned via `JSON.parse(JSON.stringify(...))`
 * before insert so that any later mutation of the inserted row (or in-memory
 * edits) cannot leak back into the shared `GLOBAL_TEMPLATES` constant.
 *
 * Note: this helper does NOT enforce uniqueness. Callers that want
 * "no duplicates per org" semantics should query for an existing
 * `{ orgId, globalKey }` row first and surface a friendly message — see
 * `app/routes/admin/drills.library.tsx` for the canonical pattern.
 *
 * @param prisma   Tenant-scoped PrismaClient (from `getTenantPrisma`).
 * @param orgId    The org to attach the cloned template to.
 * @param globalKey Stable slug from the library (e.g. `"fire-evacuation"`).
 * @throws {Response} 404 if no library template matches `globalKey`.
 * @returns The newly-created DrillTemplate row.
 */
export async function cloneGlobalTemplateToOrg(
  prisma: PrismaClient,
  orgId: string,
  globalKey: string,
) {
  const source = getGlobalTemplate(globalKey);
  if (!source) {
    throw new Response(`Unknown global template: ${globalKey}`, { status: 404 });
  }

  // Deep-clone the definition so future mutations on the persisted row never
  // mutate the shared library constant.
  const definition = JSON.parse(JSON.stringify(source.definition)) as object;

  const created = await prisma.drillTemplate.create({
    data: {
      orgId,
      name: source.name,
      drillType: source.drillType,
      authority: source.authority,
      instructions: source.instructions,
      globalKey: source.globalKey,
      definition,
    },
  });

  return created;
}
