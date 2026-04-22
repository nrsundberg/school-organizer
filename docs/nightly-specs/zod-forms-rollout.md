# Phase 2 rollout — zod + Conform across remaining form routes

## Why

Every form action in Pickup Roster currently parses `FormData` by hand
(`String(formData.get("x") ?? "")` + inline `if`s). That's the class of bug
that produced the "Save layout → unexpected server error" crash on the drill
template editor: a broken request shape would either silently coerce or
throw through to a 500.

The foundation PR (`foundation/zod-conform-forms`) adds two helpers that
collapse that pattern into a single-schema-per-intent contract. Every file
listed below should be converted to match.

## Server pattern

```ts
import { z } from "zod";
import { zfd } from "zod-form-data";
import { parseIntent } from "~/lib/forms.server";
import { dataWithSuccess } from "remix-toast";

const renameSchema = z.object({
  intent: z.literal("rename"),
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required."),
});

const deleteSchema = z.object({
  intent: z.literal("delete"),
  id: z.string().uuid(),
});

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const result = await parseIntent(request, {
    rename: renameSchema,
    delete: deleteSchema,
  });
  if (!result.success) return result.response;

  try {
    if (result.intent === "rename") {
      await prisma.room.update({ where: { id: result.data.id }, data: { name: result.data.name } });
      return dataWithSuccess(null, "Saved.");
    }
    if (result.intent === "delete") {
      await prisma.room.delete({ where: { id: result.data.id } });
      return dataWithSuccess(null, "Deleted.");
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    return dataWithError(
      null,
      err instanceof Error ? err.message : "Unexpected error.",
      { status: 500 },
    );
  }
}
```

Single-intent actions can call `parseForm(request, schema)` instead.

## Client pattern

```tsx
import { Form } from "react-router";
import { getFormProps, getInputProps, getSelectProps } from "@conform-to/react";
import { formClasses, getFieldError, useAppForm } from "~/lib/forms";
import { z } from "zod";

const schema = z.object({
  intent: z.literal("create"),
  name: z.string().trim().min(1, "Name is required."),
  plan: z.enum(["free", "pro"]),
});

export default function NewRoom() {
  const [form, fields] = useAppForm(schema, {
    id: "new-room",
    defaultValue: { intent: "create", plan: "free" },
  });

  return (
    <Form method="post" {...getFormProps(form)}>
      <input type="hidden" name="intent" value="create" />
      <label className={formClasses.labelStack}>
        Name
        <input
          {...getInputProps(fields.name, { type: "text" })}
          className={formClasses.input}
        />
        {getFieldError(fields.name) ? (
          <span className={formClasses.fieldError}>{getFieldError(fields.name)}</span>
        ) : null}
      </label>
      <select {...getSelectProps(fields.plan)} className={formClasses.select}>
        <option value="free">Free</option>
        <option value="pro">Pro</option>
      </select>
      <button type="submit" className={formClasses.btnPrimary}>
        Create
      </button>
    </Form>
  );
}
```

## Error handling

- **Field-level errors** (first broken input on a form Conform manages)
  surface via `getFieldError(fields.X)` — render them inline under the
  field with `formClasses.fieldError`.
- **Toast-level errors** (anything `parseIntent` rejects, or a
  `dataWithError` from the action body) surface via the existing
  `remix-toast` flash handler on the root layout. No extra wiring needed.
- **Prisma / domain throws** — wrap the write with `try/catch`, re-throw
  `Response` (for redirect-as-throw), and `dataWithError(null, msg, { status: 500 })`
  everything else. This is what unblocks the "unexpected server error"
  class of bugs: the user sees *what* failed.

## Agent checklist

For each route below:

1. **Import the helpers** at the top of the file:
   ```ts
   import { z } from "zod";
   import { parseIntent } from "~/lib/forms.server"; // or parseForm
   import { useAppForm, formClasses, getFieldError } from "~/lib/forms";
   import { getFormProps, getInputProps } from "@conform-to/react";
   ```
2. **Define one zod schema per intent** at the top of the file (or per
   form if the route has a single form). Use `z.literal(...)` for the
   `intent` field so `parseIntent` can discriminate.
3. **Replace the action body** — drop the manual `formData.get(...)`
   ladder, call `parseIntent` or `parseForm`, branch on `result.intent`.
4. **Wrap the Prisma / domain call** in a try/catch that re-throws
   `Response` and turns everything else into `dataWithError`.
5. **Replace the form JSX** — swap ad-hoc `<form>` for `<Form>` +
   `getFormProps(form)`; use `getInputProps(fields.X, { type })` on
   every input; render `getFieldError(fields.X)` under each field.
6. **Run `npm run typecheck`** — fix any new errors. `npm test` should
   stay green.
7. **Manual test if feasible**: `npm run dev`, hit the route, submit
   valid + invalid input, confirm:
   - valid → success toast + data persists
   - invalid → field-level error or toast with real message (no 500).

## Domain list — file groups for Phase 2 agents

Each group is roughly 2–4 hours for one agent. Agents should run on
separate branches off `foundation/zod-conform-forms` (once merged) or off
`master` if the foundation has landed.

### `auth` — 6 files

- `app/routes/auth/signup.tsx` — already uses zod (`step1Schema`,
  `step3Schema`); migrate to `parseForm`/`parseIntent` helpers so error
  shape is consistent.
- `app/routes/auth/forgot-password.tsx`
- `app/routes/auth/reset-password.tsx`
- `app/routes/auth/set-password.tsx`
- `app/routes/viewer-access.tsx`
- `app/routes/set-password.tsx`

### `admin-crud` — create / edit / settings

- `app/routes/create/*` (every file in the folder)
- `app/routes/edit/*` (every file in the folder)
- `app/routes/admin/users.tsx`
- `app/routes/admin/branding.tsx`
- `app/routes/admin/dashboard.tsx`

### `admin-drills` — drills subtree

- `app/routes/admin/drills.tsx`
- `app/routes/admin/drills.library.tsx`
- `app/routes/admin/drills.$templateId.run.tsx` *(also has pre-existing
  Prisma-typing bugs — see TypeScript baseline. Fix while you're here.)*
- `app/routes/drills.live.tsx`

### `platform-api` — internal admin + API

- `app/routes/platform/*`
- `app/routes/api/*`
- `app/routes/data.students.tsx`

## Out of scope for Phase 2

- **Loaders** that only read query-string params via `new URL(request.url).searchParams`
  — they're already narrowed by React Router's `params` typing.
- **Auth routes already using zod** — update the call sites to use
  `parseForm`, but don't re-validate fields that are already fine.
  Keep the existing rate-limiter + auth.api.getSession logic unchanged.
- **Billing webhooks** (`app/routes/api/stripe-webhook.*`) — Stripe signs
  its own payloads; we verify via `stripe.webhooks.constructEvent`, not
  FormData parsing.

## Gotchas encountered in the foundation PR

1. **`@conform-to/zod` v1.19 supports zod v4 via `/v4` subpath and via
   the default entrypoint** (default ships with zod-v4-aware types as of
   1.19). If typecheck complains about `ZodTypeAny` mismatch, try
   switching the import to `@conform-to/zod/v4`.
2. **`parseIntent` generic inference** — to get TypeScript to narrow
   `result.data` based on `result.intent`, the helper's return type is a
   mapped type `{ [K in keyof Intents & string]: { intent: K; data: z.infer<Intents[K]> } }[keyof Intents]`.
   Always check `if (result.intent === "X")` **before** touching
   `result.data` so the union collapses correctly.
3. **`FieldMetadata.errors` is typed `unknown`** when the schema is a
   discriminated zod object. Use the `getFieldError(field)` helper from
   `app/lib/forms.ts` instead of `fields.X.errors?.[0]` — the helper
   defensively handles both shapes.
4. **`dataWithError` is async in this repo's remix-toast version** —
   you must `await` it, and the `ResponseInit` is the 3rd positional
   arg (not wrapped in `{ init: ... }`). The helpers already do this;
   if you call `dataWithError` directly inside an action, await it.
5. **Separate `useFetcher()` per button** if two fetcher-driven forms
   live on the same route — otherwise clicking one button disables the
   other while in-flight. `drills.$templateId.tsx` uses `saveFetcher`
   and `liveFetcher` as the canonical example.
