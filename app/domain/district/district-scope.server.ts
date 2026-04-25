import { getPrisma } from "~/db.server";
import type { PrismaClient } from "~/db";

/**
 * Returns a Prisma client *without* the tenant-extension applied. District
 * admin code paths must use this client and must include an explicit
 * `districtId` filter on every query — the tenant-extension is not
 * scoping these requests.
 *
 * Convention: call this only from inside `district-scope.server.ts` and
 * the route loaders that drive district-aggregate views. Do not export
 * the raw client from anywhere else.
 */
export function getDistrictDb(context: any): PrismaClient {
  return getPrisma(context); // raw client; no orgId argument
}

/**
 * Helper for building the `{ org: { districtId } }` join filter used on
 * every cross-school read. Centralized so a code review can confirm
 * coverage at a glance.
 */
export function buildSchoolFilter(districtId: string) {
  return { org: { districtId } };
}

export async function listSchoolsForDistrict(context: any, districtId: string) {
  const db = getDistrictDb(context);
  return db.org.findMany({
    where: { districtId },
    orderBy: { name: "asc" },
  });
}

export type SchoolWithCounts = {
  id: string;
  name: string;
  slug: string;
  status: string;
  students: number;
  families: number;
  classrooms: number;
  lastCallAt: Date | null;
};

export async function getSchoolCountsForDistrict(
  context: any,
  districtId: string,
): Promise<SchoolWithCounts[]> {
  const db = getDistrictDb(context);
  const orgs = await db.org.findMany({
    where: { districtId },
    select: { id: true, name: true, slug: true, status: true },
    orderBy: { name: "asc" },
  });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return [];

  const [students, families, classrooms, lastCalls] = await Promise.all([
    db.student.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _count: true,
    }),
    db.household.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _count: true,
    }),
    db.space.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _count: true,
    }),
    db.callEvent.groupBy({
      by: ["orgId"],
      where: { orgId: { in: orgIds } },
      _max: { createdAt: true },
    }),
  ]);

  const byOrg = new Map<
    string,
    { students: number; families: number; classrooms: number; lastCallAt: Date | null }
  >();
  for (const id of orgIds) {
    byOrg.set(id, { students: 0, families: 0, classrooms: 0, lastCallAt: null });
  }
  for (const row of students)
    byOrg.get(row.orgId)!.students = row._count as unknown as number;
  for (const row of families)
    byOrg.get(row.orgId)!.families = row._count as unknown as number;
  for (const row of classrooms)
    byOrg.get(row.orgId)!.classrooms = row._count as unknown as number;
  for (const row of lastCalls)
    byOrg.get(row.orgId)!.lastCallAt = row._max.createdAt ?? null;

  return orgs.map((o) => ({ ...o, ...byOrg.get(o.id)! }));
}

export type DistrictRollup = {
  totalStudents: number;
  totalFamilies: number;
  totalClassrooms: number;
  callsLast7d: number;
  callsLast30d: number;
  activeSchools: number;
};

export async function getDistrictRollup(
  context: any,
  districtId: string,
): Promise<DistrictRollup> {
  const db = getDistrictDb(context);
  const filter = buildSchoolFilter(districtId);
  const now = Date.now();
  const SEVEN = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const THIRTY = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [students, families, classrooms, calls7d, calls30d, activeSchools] =
    await Promise.all([
      db.student.count({ where: filter }),
      db.household.count({ where: filter }),
      db.space.count({ where: filter }),
      db.callEvent.count({ where: { ...filter, createdAt: { gte: SEVEN } } }),
      db.callEvent.count({ where: { ...filter, createdAt: { gte: THIRTY } } }),
      db.callEvent
        .groupBy({
          by: ["orgId"],
          where: { ...filter, createdAt: { gte: THIRTY } },
          _count: true,
        })
        .then((rows) => rows.length),
    ]);

  return {
    totalStudents: students,
    totalFamilies: families,
    totalClassrooms: classrooms,
    callsLast7d: calls7d,
    callsLast30d: calls30d,
    activeSchools,
  };
}
