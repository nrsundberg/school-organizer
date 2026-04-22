/**
 * Shared server-side helpers for parsing and validating `request.formData()`
 * via zod + zod-form-data. Works in tandem with the client-side `useAppForm`
 * hook in `app/lib/forms.ts` so a single zod schema drives both sides.
 *
 * The two public entry points are:
 *
 * - `parseForm(request, schema)` — one schema per route action.
 * - `parseIntent(request, intents)` — dispatches on a hidden `intent` field,
 *   picks the matching schema from a map, returns a discriminated union.
 *
 * Both return a discriminated `Result<T>` with `{ success: true, data }` or
 * `{ success: false, response }` where the `response` is already a
 * `dataWithError`-wrapped 400 ready to be `return`-ed from the action.
 */

import { dataWithError } from "remix-toast";
import type { z, ZodTypeAny } from "zod";
import { zfd } from "zod-form-data";

type ZodIssue = z.core.$ZodIssue;

/** Discriminated result of parsing a FormData payload against a zod schema. */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: Awaited<ReturnType<typeof dataWithError>> };

/**
 * Build a human-readable message from a zod issue list. Picks the first issue
 * and prefixes the field name if present, so toasts read like
 * "name: Name is required." rather than the generic "Invalid input".
 */
export function zodErrorToMessage(issues: ZodIssue[]): string {
  const issue = issues[0];
  if (!issue) return "Invalid form data.";
  const field = issue.path.filter((p) => typeof p === "string" || typeof p === "number").join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

/**
 * Read `request.formData()` and validate it against a zod schema wrapped by
 * `zfd.formData()` (accepted automatically if the schema is a plain
 * `z.object`).
 *
 * Usage:
 * ```ts
 * const result = await parseForm(request, z.object({ name: z.string().min(1) }));
 * if (!result.success) return result.response;
 * const { name } = result.data;
 * ```
 */
export async function parseForm<Schema extends ZodTypeAny>(
  request: Request,
  schema: Schema,
): Promise<ParseResult<z.infer<Schema>>> {
  const formData = await request.formData();
  // Allow callers to pass either a raw `z.object({...})` (we wrap it) or an
  // already-wrapped `zfd.formData(...)` schema.
  const wrapped = isZfdSchema(schema) ? schema : zfd.formData(schema as unknown as ZodTypeAny);
  const parsed = (wrapped as ZodTypeAny).safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      response: await dataWithError(null, zodErrorToMessage(parsed.error.issues), { status: 400 }),
    };
  }
  return { success: true, data: parsed.data as z.infer<Schema> };
}

/**
 * Intent dispatcher — reads the `intent` field from the FormData, looks up
 * the matching zod schema from the `intents` map, and validates only the
 * fields required by that intent.
 *
 * Returns a discriminated union keyed by intent name, so TypeScript narrows
 * to the right schema inside each `if (result.intent === "rename")` branch.
 *
 * Usage:
 * ```ts
 * const result = await parseIntent(request, {
 *   rename: z.object({ name: z.string().min(1) }),
 *   delete: z.object({ id: z.string().uuid() }),
 * });
 * if (!result.success) return result.response;
 * if (result.intent === "rename") { ... result.data.name ... }
 * ```
 */
export async function parseIntent<Intents extends Record<string, ZodTypeAny>>(
  request: Request,
  intents: Intents,
): Promise<
  | {
      success: true;
      intent: keyof Intents & string;
      data: { [K in keyof Intents]: z.infer<Intents[K]> }[keyof Intents];
    }
  | { success: false; response: Awaited<ReturnType<typeof dataWithError>> }
> {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const schema = intents[intent];
  if (!schema) {
    return {
      success: false,
      response: await dataWithError(null, "Unknown action.", { status: 400 }),
    };
  }
  const wrapped = isZfdSchema(schema) ? schema : zfd.formData(schema);
  const parsed = (wrapped as ZodTypeAny).safeParse(formData);
  if (!parsed.success) {
    return {
      success: false,
      response: await dataWithError(null, zodErrorToMessage(parsed.error.issues), { status: 400 }),
    };
  }
  return {
    success: true,
    intent: intent as keyof Intents & string,
    data: parsed.data as { [K in keyof Intents]: z.infer<Intents[K]> }[keyof Intents],
  };
}

/**
 * Heuristic: `zfd.formData(...)` returns an effect-typed schema whose inner
 * shape knows how to coerce FormData entries. If a caller already wrapped
 * their schema with `zfd.formData()` we want to pass it through verbatim.
 *
 * We avoid depending on the internal zfd marker type (not exported) and
 * check for the giveaway `_zfd` brand that zod-form-data attaches in v3.
 */
function isZfdSchema(schema: ZodTypeAny): boolean {
  const proto = schema as unknown as { _zfd?: unknown };
  return proto._zfd !== undefined;
}
