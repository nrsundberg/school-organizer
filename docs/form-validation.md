# Form validation

All form handling in Pickup Roster goes through a single pattern: a zod
schema drives both client-side validation (`@conform-to/react`) and server-
side parsing (`zod-form-data`). The two pieces live in:

- `app/lib/forms.server.ts` — `parseForm`, `parseIntent`, `zodErrorToMessage`
- `app/lib/forms.ts` — `useAppForm`, `getFieldError`, `formClasses`

The canonical reference is
`app/routes/admin/drills.$templateId.tsx`.

## When to use which helper

| Situation                              | Helper            |
| -------------------------------------- | ----------------- |
| Single form, one action                | `parseForm`       |
| Multiple intents (rename / delete / …) | `parseIntent`     |
| Client-side wiring                     | `useAppForm`      |

## Adding a form — 5 minute walkthrough

### 1. Define the schema at the top of the route

```ts
import { z } from "zod";

const createRoomSchema = z.object({
  intent: z.literal("create"),
  name: z.string().trim().min(1, "Name is required.").max(120),
  capacity: z.coerce.number().int().positive().max(1000),
});
```

`z.coerce.number()` turns the `"25"` string out of `FormData` into a
real number. `z.string().trim()` strips whitespace before validating.

### 2. Write the action

```ts
import { parseIntent } from "~/lib/forms.server";
import { dataWithError, dataWithSuccess } from "remix-toast";

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const result = await parseIntent(request, {
    create: createRoomSchema,
  });
  if (!result.success) return result.response;

  try {
    if (result.intent === "create") {
      await prisma.room.create({ data: { ...result.data } });
      return dataWithSuccess(null, "Room created.");
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

**Always** wrap the Prisma write in try/catch and re-throw `Response`.
That's the pattern that surfaces real errors as toasts rather than as
opaque 500s to the user.

### 3. Write the form

```tsx
import { Form } from "react-router";
import { getFormProps, getInputProps } from "@conform-to/react";
import { formClasses, getFieldError, useAppForm } from "~/lib/forms";

export default function NewRoom() {
  const [form, fields] = useAppForm(createRoomSchema, {
    id: "create-room",
    defaultValue: { intent: "create" },
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
          <span className={formClasses.fieldError}>
            {getFieldError(fields.name)}
          </span>
        ) : null}
      </label>

      <label className={formClasses.labelStack}>
        Capacity
        <input
          {...getInputProps(fields.capacity, { type: "number" })}
          className={formClasses.input}
          min={1}
          max={1000}
        />
        {getFieldError(fields.capacity) ? (
          <span className={formClasses.fieldError}>
            {getFieldError(fields.capacity)}
          </span>
        ) : null}
      </label>

      <button type="submit" className={formClasses.btnPrimary}>Create</button>
    </Form>
  );
}
```

## How errors surface

- **Field-level (inline under the field)** — `getFieldError(fields.X)`
  returns the first zod issue on that field. Conform handles both the
  client-side validation (runs on blur, re-runs on input) and replaying
  server-side issues that come back in the action's return value.
- **Toast (banner)** — anything that short-circuits before schema
  validation (unknown intent, missing tenant) or after (Prisma failure)
  returns a `dataWithError(null, "message", { status })`. The root
  layout's `<Toaster/>` renders it automatically on the next render.

The `useAppForm` hook wires `lastResult: useActionData()?.lastResult` by
default. As long as your action returns a Conform-shaped result via
`parseWithZod({ schema, payload })` OR falls through to `dataWithError`,
the right error surface lights up.

## Progressive enhancement

The form still works with JS disabled because we use `<Form method="post">`
(React Router's plain form) with plain `name=` attributes. Conform
enhances it with client-side validation *before* submission; the server
always re-validates via `parseForm` / `parseIntent`.

## Multi-step forms

`signup.tsx` is the reference for a multi-step flow. The pattern:

- Pass `?step=N` in the URL; render the matching sub-form.
- Each step has its own zod schema and own `useAppForm` call.
- Progress is reconstructed from the server loader (which knows which
  step the user has completed), not from client state.

## Cross-field validation (password confirmation, etc.)

Use zod's `.refine`:

```ts
const schema = z
  .object({
    password: z.string().min(8),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });
```

The `path` tells `getFieldError(fields.confirm)` where to find the error.

## Coercion cheatsheet

`FormData` values are always strings. Common coercions:

| Want         | Schema                                 |
| ------------ | -------------------------------------- |
| Number       | `z.coerce.number()`                    |
| Integer ≥ 0  | `z.coerce.number().int().nonnegative()`|
| Boolean      | `zfd.checkbox()` (from `zod-form-data`)|
| Date         | `z.coerce.date()`                      |
| JSON blob    | `z.string().transform((s) => JSON.parse(s))` (wrap in try/catch via `z.transform`) |

For file uploads use `zfd.file()` + your R2/Workers upload helper.

## See also

- `app/lib/forms.server.ts` — helper implementations
- `app/lib/forms.ts` — client hook + shared classes
- `app/routes/admin/drills.$templateId.tsx` — reference route
- `docs/nightly-specs/zod-forms-rollout.md` — Phase 2 agent migration list
