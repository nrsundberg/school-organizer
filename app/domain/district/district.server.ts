import type { District } from "~/db";
import { getPrisma } from "~/db.server";

const SLUG_DISALLOWED = /[^a-z0-9-]+/g;
const COLLAPSE_DASHES = /-+/g;

export function slugifyDistrictName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(SLUG_DISALLOWED, "-")
    .replace(COLLAPSE_DASHES, "-")
    .replace(/^-+|-+$/g, "");
}

export type CreateDistrictInput = {
  name: string;
  requestedSlug?: string;
};

/**
 * Create a District in TRIALING status with default schoolCap. The first
 * district admin user is created separately by the signup flow; this
 * function only creates the District row.
 */
export async function createDistrict(
  context: any,
  input: CreateDistrictInput,
): Promise<District> {
  const db = getPrisma(context);
  const requested = input.requestedSlug ?? input.name;
  const slug = slugifyDistrictName(requested);
  if (!slug) {
    throw new Error("A valid district slug is required.");
  }
  const taken = await db.district.findUnique({ where: { slug } });
  if (taken) {
    throw new Error("That district slug is already taken.");
  }
  const trialStartedAt = new Date();
  return db.district.create({
    data: {
      name: input.name.trim(),
      slug,
      status: "TRIALING",
      schoolCap: 3,
      billingPlan: "DISTRICT",
      trialStartedAt,
    },
  });
}

export async function getDistrictById(
  context: any,
  id: string,
): Promise<District | null> {
  const db = getPrisma(context);
  return db.district.findUnique({ where: { id } });
}

export async function getDistrictBySlug(
  context: any,
  slug: string,
): Promise<District | null> {
  const db = getPrisma(context);
  return db.district.findUnique({ where: { slug } });
}

export async function getDistrictSchoolCount(
  context: any,
  districtId: string,
): Promise<number> {
  const db = getPrisma(context);
  return db.org.count({ where: { districtId } });
}

export type CapState = {
  state: "within" | "at" | "over";
  count: number;
  cap: number;
  over: number;
};

export function computeCapState(count: number, cap: number): CapState {
  if (count < cap) return { state: "within", count, cap, over: 0 };
  if (count === cap) return { state: "at", count, cap, over: 0 };
  return { state: "over", count, cap, over: count - cap };
}

export async function isOverSchoolCap(
  context: any,
  district: District,
): Promise<boolean> {
  const count = await getDistrictSchoolCount(context, district.id);
  return computeCapState(count, district.schoolCap).state === "over";
}
