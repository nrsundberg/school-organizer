import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { adminAc } from "better-auth/plugins/admin/access";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getPrisma } from "~/db.server";
import { assertUserScopeXor } from "./user-scope.server";
import {
  shouldShareAuthCookiesAcrossSubdomains,
  sharedSessionCookieDomain,
  normalizeRootDomain,
} from "./cookie-domain.server";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordBool,
  parseStoredHash,
  type VerifyResult,
  type ParsedHash,
  type HashAlgo,
} from "~/domain/auth/password-hash";

// Re-export so existing callers that import { hashPassword,
// verifyPassword } from "~/domain/auth/better-auth.server" keep working.
export {
  hashPassword,
  verifyPassword,
  verifyPasswordBool,
  parseStoredHash,
  type VerifyResult,
  type ParsedHash,
  type HashAlgo,
};

// Re-export the cookie-domain helper for callers that already import it
// from this module (viewer-access.server.ts). The implementation lives in
// `./cookie-domain.server` so it can be unit-tested without dragging in
// the Prisma adapter chain.
export { sharedSessionCookieDomain };

function marketingHostsFromEnv(env: Record<string, string | undefined>): string[] {
  return (env.MARKETING_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Cache at module level — reused across requests within the same CF Worker isolate.
// Keyed by env object reference so local dev (process.env) and prod (CF env) stay separate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedAuth: any = null;
let cachedEnvRef: unknown = null;

export function getAuth(context: any) {
  const env = context?.cloudflare?.env ?? process.env;

  if (cachedAuth && cachedEnvRef === env) {
    return cachedAuth;
  }

  const db = getPrisma(context);
  const isProduction = env.ENVIRONMENT !== "development";
  const envRecord = env as Record<string, string | undefined>;
  const publicRoot = normalizeRootDomain(envRecord);
  const shareSubdomainCookies = shouldShareAuthCookiesAcrossSubdomains(publicRoot, envRecord);

  const secret = (env as any).BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;

  const marketingHosts = marketingHostsFromEnv(envRecord);
  const baseURLConfig =
    shareSubdomainCookies && publicRoot
      ? {
          baseURL: {
            allowedHosts: [publicRoot, `www.${publicRoot}`, `*.${publicRoot}`, ...marketingHosts],
            protocol: "https" as const,
            fallback: `https://${publicRoot}`,
          },
          trustedOrigins: [
            `https://${publicRoot}`,
            `https://www.${publicRoot}`,
            `https://*.${publicRoot}`,
          ],
        }
      : {};

  const cfCtx = (context as any)?.cloudflare?.ctx;

  /**
   * better-auth expects `verify` to return a plain boolean. This
   * closure wraps verifyPassword() so it can (a) return the boolean
   * better-auth wants, and (b) opportunistically rehash the Account
   * row when the stored hash is legacy-format or below the current
   * iteration target. The persistence is fire-and-forget via
   * ctx.waitUntil on Workers, otherwise awaited inline (safe — login
   * already round-trips in the hundreds of ms so a few extra ms is
   * immaterial). Errors while persisting the new hash are swallowed
   * so a DB write failure can never turn a good password into a login
   * error; the next successful login will retry.
   */
  const verifyForBetterAuth = async ({
    hash,
    password,
  }: {
    hash: string;
    password: string;
  }): Promise<boolean> => {
    const result = await verifyPassword(hash, password);
    if (result.ok && result.needsRehash) {
      const task = (async () => {
        try {
          const newHash = await hashPassword(password);
          // Scope by the exact stored hash so we touch only the Account
          // rows that actually held this credential. In practice each
          // user has one credentials Account but scoping by hash keeps
          // unrelated rows untouched even if two users share a password.
          await db.account.updateMany({
            where: { password: hash },
            data: { password: newHash },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[pbkdf2-rehash] failed to persist new hash", err);
        }
      })();

      if (cfCtx && typeof cfCtx.waitUntil === "function") {
        cfCtx.waitUntil(task);
      } else {
        await task;
      }
    }
    return result.ok;
  };

  const auth = betterAuth({
    basePath: "/api/auth",
    secret,
    ...baseURLConfig,
    advanced: {
      cookiePrefix: "pickuproster",
      useSecureCookies: isProduction,
      ...(shareSubdomainCookies && publicRoot
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: publicRoot,
            },
          }
        : {}),
      ...(cfCtx
        ? {
            backgroundTasks: {
              handler: (promise: Promise<unknown>) => {
                cfCtx.waitUntil(promise);
              },
            },
          }
        : {}),
    },
    database: prismaAdapter(db, {
      provider: "sqlite",
      // D1 does not support interactive transactions
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      password: {
        hash: hashPassword,
        verify: verifyForBetterAuth,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // Refresh after 1 day of activity
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5-min in-memory cache to reduce DB hits
      },
      additionalFields: {
        impersonatedOrgId: {
          type: "string",
          required: false,
          defaultValue: null,
          input: false,
        },
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "VIEWER",
        },
        mustChangePassword: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
        controllerViewPreference: {
          type: "string",
          required: false,
        },
        phone: {
          type: "string",
          required: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Many flows (e.g. better-auth signup) create a User with no
            // scope and immediately update — the application layer attaches
            // orgId/districtId in a follow-up step. We only enforce the
            // invariant when at least one scope field is present in the
            // payload, so those flows still work.
            const u = user as {
              orgId?: string | null;
              districtId?: string | null;
              role?: string | null;
            };
            const isPlatformAdmin = u.role === "PLATFORM_ADMIN";
            const hasScopeField =
              u.orgId != null || u.districtId != null || isPlatformAdmin;
            if (hasScopeField) {
              assertUserScopeXor({
                orgId: u.orgId ?? null,
                districtId: u.districtId ?? null,
                isPlatformAdmin,
              });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      admin({
        adminRoles: ["ADMIN", "PLATFORM_ADMIN"],
        // Stock `adminAc` grants `user:impersonate` but not
        // `user:impersonate-admins`, so without this flag the plugin
        // refuses every target whose role is in `adminRoles` — which is
        // the whole point of platform staff impersonating school admins.
        // Caller is already gated to PLATFORM_ADMIN by `requirePlatformAdmin`.
        allowImpersonatingAdmins: true,
        roles: {
          ADMIN: adminAc,
          PLATFORM_ADMIN: adminAc,
        },
      }),
    ],
  });

  cachedAuth = auth;
  cachedEnvRef = env;
  return auth;
}

export type BetterAuthSession = NonNullable<
  Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>
>;
