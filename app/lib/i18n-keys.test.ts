/**
 * i18n key integrity guard.
 *
 * Two failure modes this catches, both of which have bitten us:
 *
 *  1. A component references a `t("key")` that doesn't exist in the
 *     translation JSON. i18next then renders the raw key string to users
 *     (e.g. the `households.detail.rail.linkedAdmin*` regression where the
 *     JSON only had `linkedUser*`). This test fails the build instead.
 *  2. A key exists in `en` but is missing from `es` (or vice-versa), which
 *     would silently fall back to English for Spanish users.
 *
 * Referenced keys are collected with the SAME lexer that powers
 * `npm run i18n:extract` (i18next-parser), so extraction stays consistent
 * with the rest of the i18n pipeline and we avoid a hand-rolled regex — a
 * naive `t(` grep over this codebase yields ~2800 false positives.
 *
 * Known blind spot: keys built dynamically (`t(`status.${x}`)`) can't be
 * statically extracted, so they aren't checked here. Their roots were
 * hand-audited; if you add a dynamic key, make sure every variant exists.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { I18N_NAMESPACES, type I18nNamespace } from "./i18n-config";

const require = createRequire(import.meta.url);

// i18next-parser ships type declarations only for its config interfaces, not
// its Lexer classes, so import it untyped and assert the slice we use.
interface Lexer {
  extract(
    code: string,
    filename: string,
  ): Array<{ key: string; namespace?: string }>;
}
interface LexerCtor {
  new (opts: Record<string, unknown>): Lexer;
}
const { JsxLexer, JavascriptLexer } = require("i18next-parser") as {
  JsxLexer: LexerCtor;
  JavascriptLexer: LexerCtor;
};

const NS_SEPARATOR = ":";
// i18next plural suffixes (v4 shape) — a `t("x", { count })` call resolves to
// `x_one` / `x_other` etc. in the JSON rather than a bare `x`.
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const appDir = path.join(repoRoot, "app");
const localesDir = path.join(repoRoot, "public", "locales");

// Only `useTranslation` binds a default namespace statically; `getFixedT(lng,
// ns)` takes the locale first, so registering it as a namespace function would
// mis-resolve the locale AS the namespace. Those keys come back namespace-less
// and fall to the lenient cross-namespace check below.
const lexerOpts = { functions: ["t"], namespaceFunctions: ["useTranslation"] };

/** Recursively list source files under `app/`, excluding tests + generated. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Every node path (intermediate objects AND leaves) in a resource tree. */
function collectPaths(
  obj: Record<string, unknown>,
  prefix: string,
  out: Set<string>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      collectPaths(v as Record<string, unknown>, p, out);
    }
  }
}

function loadPaths(locale: string, ns: I18nNamespace): Set<string> {
  const file = path.join(localesDir, locale, `${ns}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out = new Set<string>();
  collectPaths(json, "", out);
  return out;
}

function keyExists(paths: Set<string>, key: string): boolean {
  if (paths.has(key)) return true;
  return PLURAL_SUFFIXES.some((s) => paths.has(`${key}_${s}`));
}

const enPaths = new Map<I18nNamespace, Set<string>>(
  I18N_NAMESPACES.map((ns) => [ns, loadPaths("en", ns)]),
);

/** Collect every statically-resolvable (namespace, key) referenced in code. */
function referencedKeys(): Array<{
  file: string;
  ns?: string;
  key: string;
}> {
  const refs: Array<{ file: string; ns?: string; key: string }> = [];
  for (const file of sourceFiles(appDir)) {
    const code = readFileSync(file, "utf8");
    const lexer = file.endsWith(".tsx")
      ? new JsxLexer(lexerOpts)
      : new JavascriptLexer(lexerOpts);
    let extracted: Array<{ key: string; namespace?: string }>;
    try {
      extracted = lexer.extract(code, file);
    } catch {
      // A file the lexer can't parse shouldn't fail the whole check.
      continue;
    }
    for (const entry of extracted) {
      let key = entry.key;
      let ns = entry.namespace;
      // The lexer doesn't split a `ns:key` prefix when a default namespace is
      // also in scope, so do it here — an explicit prefix wins.
      const sep = key.indexOf(NS_SEPARATOR);
      if (sep !== -1) {
        ns = key.slice(0, sep);
        key = key.slice(sep + 1);
      }
      refs.push({ file: path.relative(repoRoot, file), ns, key });
    }
  }
  return refs;
}

test("every referenced i18n key exists in the en resources", () => {
  const knownNs = new Set<string>(I18N_NAMESPACES);
  const misses: string[] = [];

  for (const { file, ns, key } of referencedKeys()) {
    if (ns && knownNs.has(ns)) {
      // Namespace resolved to a real namespace → strict: must exist there.
      if (!keyExists(enPaths.get(ns as I18nNamespace)!, key)) {
        misses.push(`${file}: "${ns}:${key}" missing from en/${ns}.json`);
      }
    } else {
      // Namespace unknown or unresolved (e.g. `t` passed in / via getFixedT) →
      // lenient: accept if the key exists in ANY namespace.
      const found = I18N_NAMESPACES.some((n) => keyExists(enPaths.get(n)!, key));
      if (!found) {
        misses.push(`${file}: "${key}" missing from every en/*.json namespace`);
      }
    }
  }

  assert.equal(
    misses.length,
    0,
    `Found ${misses.length} i18n key(s) referenced in code but absent from the en resources:\n  ${misses.join("\n  ")}`,
  );
});

test("en and es resources have identical key structure", () => {
  const mismatches: string[] = [];
  for (const ns of I18N_NAMESPACES) {
    const en = enPaths.get(ns)!;
    const es = loadPaths("es", ns);
    for (const p of en) {
      if (!es.has(p)) mismatches.push(`${ns}: "${p}" in en but missing from es`);
    }
    for (const p of es) {
      if (!en.has(p)) mismatches.push(`${ns}: "${p}" in es but missing from en`);
    }
  }

  assert.equal(
    mismatches.length,
    0,
    `Found ${mismatches.length} en/es parity gap(s):\n  ${mismatches.join("\n  ")}`,
  );
});
