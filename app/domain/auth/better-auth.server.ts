import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { adminAc } from "better-auth/plugins/admin/access";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getPrisma } from "~/db.server";

// Use native Web Crypto PBKDF2 — runs in native code, not pure JS,
// so it fits within Cloudflare Workers CPU limits unlike scrypt.
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_KEY_LEN = 32; // bytes

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pbkdf2Key(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS },
    key,
    PBKDF2_KEY_LEN * 8,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2Key(password, salt);
  return `${toHex(salt.buffer)}:${toHex(bits)}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const bits = await pbkdf2Key(password, salt);
  const target = new Uint8Array(bits);
  const stored = new Uint8Array(keyHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  if (target.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < target.length; i++) diff |= target[i] ^ stored[i];
  return diff === 0;
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

  const secret = (env as any).BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;

  const auth = betterAuth({
    basePath: "/api/auth",
    secret,
    advanced: {
      cookiePrefix: "tome",
      useSecureCookies: isProduction,
      ...(context as any)?.cloudflare?.ctx
        ? {
            backgroundTasks: {
              handler: (promise: Promise<unknown>) => {
                (context as any).cloudflare.ctx.waitUntil(promise);
              },
            },
          }
        : {},
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
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days
      updateAge: 60 * 60 * 24, // Refresh after 1 day of activity
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5-min in-memory cache to reduce DB hits
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
      },
    },
    plugins: [
      admin({
        adminRoles: ["ADMIN"],
        roles: {
          ADMIN: adminAc,
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
