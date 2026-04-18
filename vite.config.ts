import { execSync } from "node:child_process";
import path from "node:path";
import type { Plugin } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import { sentryReactRouter } from "@sentry/react-router";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import devtoolsJson from "vite-plugin-devtools-json";
import tailwindcss from "@tailwindcss/vite";
import babel from "vite-plugin-babel";

// Prisma 7 generates ?module WASM imports (Cloudflare Workers syntax).
// Vite can't parse them — mark them external so wrangler handles them instead.
const cloudflareWasmModule: Plugin = {
  name: "cloudflare-wasm-module",
  enforce: "pre",
  resolveId(id) {
    if (id.includes(".wasm") && id.endsWith("?module")) {
      // Return a path relative to build/server/ so wrangler can resolve it
      return {
        id: "../../app/db/internal/query_compiler_fast_bg.wasm?module",
        external: true,
      };
    }
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
