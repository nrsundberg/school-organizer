/**
 * Per-schema Zod (v4) error map (option (b) from the i18n contract).
 *
 * Builds a `z.core.$ZodErrorMap` from a pre-resolved `t` function (typically
 * the `errors` namespace pinned to the request locale). Use it on a per-
 * `safeParse` basis rather than `z.config({ customError: ... })`, so server-
 * side validation that never surfaces to a user keeps its default English
 * messages.
 *
 * Zod v4 note: the error map signature is `(issue) => ...`, not `(issue, ctx)`.
 * `safeParse` accepts the map via the `{ error: ... }` field on its
 * `ParseContext`, e.g.
 *
 * ```ts
 * import { detectLocale } from "~/i18n.server";
 * import { getFixedT } from "~/lib/t.server";
 * import { localizedErrorMap } from "~/lib/zod-error-map.server";
 *
 * const locale = await detectLocale(request, context);
 * const t = await getFixedT(locale, "errors");
 * const result = schema.safeParse(formData, { error: localizedErrorMap(t) });
 * ```
 *
 * The `errors:zod.*` keys live in `public/locales/{lng}/errors.json`. New
 * `issue.code` cases should add a new key there before adding a switch arm
 * here — keep the map driven by the JSON, not the other way around.
 */

import type { TFunction } from "i18next";
import type { z } from "zod";

type ErrorMap = z.core.$ZodErrorMap;

/**
 * Build an error map for the active language. Caller is expected to pre-load
 * the `errors` namespace (or call `getFixedT(lng, "errors")`).
 *
 * Returns either `{ message }` or `undefined` (which lets zod fall back to its
 * default English string for issue codes we don't have a translation for).
 */
export function localizedErrorMap(t: TFunction): ErrorMap {
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        // FormData "missing field" comes through as invalid_type with input
        // === undefined; treat that as "required" rather than verbose-typed.
        if (issue.input === undefined || issue.input === null) {
          return { message: t("errors:zod.invalidTypeRequired") };
        }
        return {
          message: t("errors:zod.invalidType", {
            expected: String((issue as any).expected ?? ""),
            received: typeof issue.input,
          }),
        };
      }
      case "too_small": {
        const min = (issue as any).minimum;
        const origin = (issue as any).origin as string | undefined;
        if (origin === "string") {
          if (Number(min) <= 1) {
            return { message: t("errors:zod.tooSmallStringEmpty") };
          }
          return { message: t("errors:zod.tooSmallString", { minimum: min }) };
        }
        if (origin === "number" || origin === "int" || origin === "bigint") {
          return { message: t("errors:zod.tooSmallNumber", { minimum: min }) };
        }
        if (origin === "array" || origin === "set" || origin === "file") {
          return { message: t("errors:zod.tooSmallArray", { minimum: min }) };
        }
        return { message: t("errors:zod.tooSmall", { minimum: min }) };
      }
      case "too_big": {
        const max = (issue as any).maximum;
        const origin = (issue as any).origin as string | undefined;
        if (origin === "string") {
          return { message: t("errors:zod.tooBigString", { maximum: max }) };
        }
        if (origin === "number" || origin === "int" || origin === "bigint") {
          return { message: t("errors:zod.tooBigNumber", { maximum: max }) };
        }
        if (origin === "array" || origin === "set" || origin === "file") {
          return { message: t("errors:zod.tooBigArray", { maximum: max }) };
        }
        return { message: t("errors:zod.tooBig", { maximum: max }) };
      }
      case "invalid_format": {
        // v4 "invalid_format" replaces v3 "invalid_string". `format` is the
        // discriminator: "email", "url", "uuid", "regex", etc.
        const format = (issue as any).format as string | undefined;
        switch (format) {
          case "email":
            return { message: t("errors:zod.invalidStringEmail") };
          case "url":
            return { message: t("errors:zod.invalidStringUrl") };
          case "uuid":
          case "nanoid":
          case "cuid":
          case "cuid2":
          case "ulid":
            return { message: t("errors:zod.invalidStringUuid") };
          case "regex":
          case "starts_with":
          case "ends_with":
          case "includes":
            return { message: t("errors:zod.invalidStringRegex") };
          default:
            return { message: t("errors:zod.invalidString") };
        }
      }
      case "invalid_value": {
        const values = (issue as any).values as unknown[] | undefined;
        return {
          message: t("errors:zod.invalidEnum", {
            options: Array.isArray(values) ? values.join(", ") : "",
          }),
        };
      }
      case "invalid_union":
        return { message: t("errors:zod.invalidUnion") };
      case "custom": {
        // Allow callers to attach an explicit translation key via `params.i18nKey`.
        const params = (issue as any).params as Record<string, unknown> | undefined;
        const i18nKey = params?.i18nKey as string | undefined;
        if (i18nKey) {
          return { message: t(i18nKey, params ?? {}) };
        }
        return { message: t("errors:zod.custom") };
      }
      default:
        // Let zod use its built-in English message for codes we don't translate.
        return undefined;
    }
  };
}

/**
 * Convenience wrapper that resolves the locale + namespace and returns a
 * ready-to-use error map. Saves callers the two-line setup at every site.
 */
export async function makeLocalizedErrorMap(lng: string): Promise<ErrorMap> {
  const { getFixedT } = await import("~/lib/t.server");
  const t = await getFixedT(lng, "errors");
  return localizedErrorMap(t);
}
