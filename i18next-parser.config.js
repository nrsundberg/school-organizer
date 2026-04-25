/**
 * i18next-parser config — drives `npm run i18n:extract`.
 *
 * Walks the source tree, finds every `t("namespace:key.path")` call (and
 * the `useTranslation("ns")` declarations that bind the default namespace
 * for a file), and merges any new keys into `public/locales/en/*.json`.
 * Existing keys + their values are preserved; this is purely additive.
 *
 * Spanish (`es`) files are also touched but with empty values, so Phase 3
 * translators see only the keys that need work. This is the i18next-parser
 * default when `keepRemoved: true` is set; we leave that on so unused
 * keys aren't silently dropped without review.
 *
 * Conventions enforced (also documented in docs/i18n-contract.md):
 *
 *  - Key separator is `.`  (e.g. `admin.children.addButton`).
 *  - Namespace separator is `:` (e.g. `t("admin:children.addButton")`).
 *  - Default namespace is `common` — keys without a namespace go there.
 *  - Plural keys use the i18next `_one`/`_other` suffix automatically.
 */

/** @type {import("i18next-parser").UserConfig} */
export default {
  // Languages we currently ship. Stays in sync with app/lib/i18n-config.ts.
  locales: ["en", "es"],

  // Where to read the existing JSON and write back updates.
  output: "public/locales/$LOCALE/$NAMESPACE.json",

  // The full set of namespaces. The parser will create any that don't
  // exist yet (e.g. when a Phase 2 agent introduces a new file).
  defaultNamespace: "common",

  // Files we scan for `t(...)` and `useTranslation(...)` calls.
  input: ["app/**/*.{ts,tsx}"],

  // Key conventions — match the ones documented in the contract.
  keySeparator: ".",
  namespaceSeparator: ":",

  // Sort the JSON alphabetically so diffs stay reviewable.
  sort: true,

  // Don't drop keys we no longer find in source — they may still be
  // referenced through dynamic key construction. Phase 2 agents can prune
  // by hand if they're confident.
  keepRemoved: true,

  // Use empty string ("") as the default value for missing keys in non-
  // default locales, so es JSON files stay clean for translators.
  defaultValue: (locale, namespace, key) => {
    if (locale === "en") {
      // For English we leave the value as the key path itself, which is
      // what i18next-parser does by default. Phase 2 agents should fill
      // the real strings during extraction, replacing this placeholder.
      return key;
    }
    return "";
  },

  // i18next plural suffixes — the project uses the v4+ shape.
  pluralSeparator: "_",
  contextSeparator: "_",

  // Don't fail the build on missing namespaces (we add them as we go).
  failOnWarnings: false,

  // Verbosity — quiet by default; set DEBUG=i18next-parser to see more.
  verbose: false,

  // Whether to indent the output JSON. Two spaces matches the rest of
  // the repo's JSON files.
  jsonIndent: 2,
};
