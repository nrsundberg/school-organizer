import { PrismaClient } from "./db/generated/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { tenantExtension } from "./db/tenant-extension";

// Cache at module level — reused across requests within the same CF Worker isolate.
let cachedPrisma: PrismaClient | null = null;
let cachedD1: unknown = null;

export function getPrisma(context: any, orgId?: string): PrismaClient {
  if (!context?.cloudflare?.env?.D1_DATABASE) {
    throw new Error(
      "getPrisma: D1_DATABASE binding not found. Run via `wrangler dev` or check your Cloudflare environment."
    );
  }
  const d1 = context.cloudflare.env.D1_DATABASE;
  if (cachedPrisma && cachedD1 === d1) {
    return orgId ? (cachedPrisma.$extends(tenantExtension(orgId)) as unknown as PrismaClient) : cachedPrisma;
  }
  const adapter = new PrismaD1(d1);
  cachedPrisma = new PrismaClient({ adapter });
  cachedD1 = d1;
  return orgId ? (cachedPrisma.$extends(tenantExtension(orgId)) as unknown as PrismaClient) : cachedPrisma;
}
