/**
 * Client-side helpers for the shared zod + Conform form pattern.
 *
 * `useAppForm(schema)` is a thin opinionated wrapper around Conform's
 * `useForm` that wires up:
 *   - `parseWithZod` from `@conform-to/zod` as the client-side validator
 *   - `useActionData()` as the source of server-side validation results
 *   - `shouldValidate: "onBlur"` + `shouldRevalidate: "onInput"` defaults that
 *     match the feel teachers expect on touch devices
 *
 * Pair with `parseForm` / `parseIntent` from `app/lib/forms.server.ts` so the
 * same schema validates both sides of the request.
 */

import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { useActionData } from "react-router";
import type { ZodTypeAny, z } from "zod";

type UseFormOptions = Parameters<typeof useForm>[0];

/** Options accepted by `useAppForm` — pass-throughs to Conform's `useForm`. */
export type AppFormOptions<Schema extends ZodTypeAny> = Omit<
  UseFormOptions,
  "onValidate" | "lastResult"
> & {
  /** Explicit `lastResult` override. Defaults to `useActionData()`. */
  lastResult?: UseFormOptions["lastResult"];
  /**
   * Optional extra refinement run after zod parsing — useful for field-level
   * checks that need the whole form (cross-field matching passwords etc.).
   */
  onRefine?: (value: z.infer<Schema>) => void;
};

/**
 * Wire a zod schema into Conform with sensible defaults. Returns the
 * `[form, fields]` tuple `useForm` produces.
 *
 * ```tsx
 * const schema = z.object({ name: z.string().min(1) });
 * const [form, fields] = useAppForm(schema);
 * return (
 *   <form {...getFormProps(form)}>
 *     <input {...getInputProps(fields.name, { type: "text" })} />
 *     {fields.name.errors && <p>{fields.name.errors[0]}</p>}
 *   </form>
 * );
 * ```
 */
export function useAppForm<Schema extends ZodTypeAny>(
  schema: Schema,
  options: AppFormOptions<Schema> = {},
) {
  const actionData = useActionData() as
    | { lastResult?: UseFormOptions["lastResult"] }
    | undefined;
  const { onRefine, lastResult, ...rest } = options;

  return useForm({
    // Default to action-data-driven validation; callers can override.
    lastResult: lastResult ?? actionData?.lastResult,
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
    ...rest,
    onValidate({ formData }) {
      const result = parseWithZod(formData, { schema });
      if (result.status === "success" && onRefine) {
        onRefine(result.value as z.infer<Schema>);
      }
      return result;
    },
  });
}

/**
 * Return the first error on a Conform field, or `undefined` if valid / not
 * yet touched. Encapsulates the `errors?.[0]` dance so callers read cleanly.
 *
 * Accepts the broader `errors?: unknown` because Conform's default FormError
 * generic is `string[]` but the `useForm` return type may widen to `unknown`
 * when the schema is inferred from a discriminated zod object. We coerce
 * defensively.
 */
export function getFieldError(
  field: { errors?: unknown } | undefined | null,
): string | undefined {
  const errors = field?.errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") {
    return errors[0];
  }
  return undefined;
}

/**
 * Shared Tailwind class strings matching the idiom used across admin routes
 * (see `app/routes/admin/drills.$templateId.tsx` and
 * `app/routes/admin/branding.tsx`). Centralising them here means Phase 2
 * agents don't copy-paste divergent spellings of the same button.
 *
 * Dark-themed admin surfaces only — marketing pages use HeroUI directly.
 */
export const formClasses = {
  /** Label wrapping a form field with text above the input. */
  labelStack: "text-sm text-white/60 flex flex-col gap-1",
  /** Standard text/email/number/url input. */
  input:
    "rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white focus:outline-none focus:border-blue-400 disabled:opacity-60",
  /** Compact input used inside tables. */
  inputCompact:
    "rounded border border-white/20 bg-white/5 px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-400",
  /** Native <select> styled to match the dark surface. */
  select:
    "rounded-lg border border-white/20 bg-[#1a1f1f] px-3 py-2 text-white focus:outline-none focus:border-blue-400",
  /** Primary action button (solid blue). */
  btnPrimary:
    "inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  /** Secondary button (outlined translucent). */
  btnSecondary:
    "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  /** Inline error message rendered under a field. */
  fieldError: "text-xs text-rose-300",
} as const;
