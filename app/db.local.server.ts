// Local development fallback — used only when react-router dev runs without
// a Cloudflare context. Swapped in by vite.config.ts alias in dev mode.
import { PrismaClient } from "./db/generated/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { tenantExtension } from "./db/tenant-extension";

declare global {
  var __prisma: PrismaClient | undefined;
}

export function getPrisma(_context: unknown, orgId?: string): PrismaClient {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      adapter: new PrismaLibSql({
        url: process.env.DATABASE_URL ?? "file:./dev.db",
      }),
    });
  }
  return orgId ? (global.__prisma.$extends(tenantExtension(orgId)) as unknown as PrismaClient) : global.__prisma;
}
