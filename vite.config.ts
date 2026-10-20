import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import type { Plugin } from "vite";
import { sentryReactRouter } from "@sentry/react-router";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import devtoolsJson from "vite-plugin-devtools-json";
import tailwindcss from "@tailwindcss/vite";
import babel from "vite-plugin-babel";

// Prisma 7 uses `*.wasm?module` imports (Workers). Rollup cannot parse WASM; externalize so the
// path resolves at deploy time. Path is relative to build/server/index.js (same idea as church-finder-inagg).
const cloudflareWasmModule: Plugin = {
  name: "cloudflare-wasm-module",
  enforce: "pre",
  // The relative wasm id is for the Worker bundle (resolved from
  // build/server/index.js). Applying it during `react-router dev` makes Vite
  // look for app/db/app/db/generated/... and every Prisma call fails.
  apply: "build",
  resolveId(id) {
    if (id.includes(".wasm") && id.endsWith("?module")) {
      return {
        id: "../../app/db/generated/internal/query_compiler_fast_bg.wasm?module",
        external: true,
      };
    }
  },
};

const prismaWasmFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "app/db/generated/internal/query_compiler_fast_bg.wasm",
);

/** Dev-only loader. Prisma's `*.wasm?module` import is a Workers convention. */
const prismaWasmDev: Plugin = {
  name: "prisma-wasm-dev",
  apply: "serve",
  enforce: "pre",
  resolveId(id) {
    if (id.includes("query_compiler_fast_bg.wasm") && id.includes("?module")) {
      return "\0prisma-query-compiler-wasm";
    }
  },
  load(id) {
    if (id !== "\0prisma-query-compiler-wasm") return null;
    return `
      import { readFileSync } from "node:fs";
      const bytes = readFileSync(${JSON.stringify(prismaWasmFile)});
      export default new WebAssembly.Module(bytes);
    `;
  },
};

function getGitSha(): string {
  try {
    return (
      process.env.SENTRY_RELEASE ||
      execSync("git rev-parse --short HEAD").toString().trim()
    );
  } catch {
    return "unknown";
  }
}

export default defineConfig((config) => {
  const env = loadEnv(config.mode, process.cwd(), "");
  const release = getGitSha();

  return {
    resolve: {
      alias:
        config.mode === "development"
          ? {
              "~/db.server": path.resolve(
                process.cwd(),
                "app/db.local.server.ts",
              ),
            }
          : undefined,
    },
    ssr: {
      resolve: {
        conditions: ["workerd", "browser"],
        externalConditions: ["workerd", "browser"],
      },
    },
    define: {
      __SENTRY_RELEASE__: JSON.stringify(release),
    },
    build: {
      sourcemap: !!env.SENTRY_AUTH_TOKEN,
    },
    server: {
      port: 3000,
    },
    plugins: [
      prismaWasmDev,
      cloudflareWasmModule,
      tailwindcss(),
      reactRouter(),
      ...(env.SENTRY_AUTH_TOKEN
        ? [
            sentryReactRouter(
              {
                org: env.SENTRY_ORG,
                project: env.SENTRY_PROJECT,
                authToken: env.SENTRY_AUTH_TOKEN,
                release: { name: release },
                telemetry: false,
              },
              config,
            ),
          ]
        : []),
      tsconfigPaths(),
      devtoolsJson(),
      babel({
        filter: /app\/.*\.[jt]sx?$/,
        babelConfig: {
          presets: ["@babel/preset-typescript"],
          plugins: [["babel-plugin-react-compiler"]],
        },
      }),
    ],
  };
});
