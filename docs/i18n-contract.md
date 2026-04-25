# i18n Contract — pickup-roster

This document is the canonical reference for how strings are extracted,
keyed, loaded, and translated in this codebase. **Phase 2 agents read this
first.** Anything you do that contradicts what's written here is wrong;
file a PR against this doc instead.

If a question isn't answered here, ask in the team thread before inventing
an answer — multiple parallel agents inventing different answers is the
exact failure mode this contract exists to prevent.

---

## TL;DR for Phase 2 agents

1. Replace hardcoded UI strings with `t("namespace:section.key")`.
2. Add the new key to the matching `public/locales/en/<namespace>.json`.
3. Mirror it into `public/locales/es/<namespace>.json` with an empty string.
4. If the route uses a namespace beyond `common`, declare it via
   `export const handle = { i18n: ["admin", "common"] }`.
5. **Don't translate user-generated data** (kid names, school names,
   parent names, custom drill names) — only UI chrome.

---

## Architecture overview

| File | Purpose |
|---|---|
| `app/lib/i18n-config.ts` | Source of truth: supported languages, namespaces, cookie name. |
| `app/i18n.ts` | Client init (lazy backend, browser detector as fallback). |
| `app/i18n.server.ts` | Server detector chain + `RemixI18Next` instance. |
| `app/lib/t.server.ts` | Server-only `getFixedT(lng, ns)` for emails / Zod / etc. |
| `app/components/LanguageSwitcher.tsx` | Globe-icon dropdown, posts to `/api/user-prefs`. |
| `app/hooks/usePrintLocale.ts` | Resolves the locale a print route should render in. |
| `public/locales/{en,es}/<ns>.json` | Translation strings, one file per (lang, namespace). |
| `i18next-parser.config.js` | Drives `npm run i18n:extract`. |

---

## Namespaces

We ship six namespaces. Putting strings in the wrong namespace doesn't
break anything functionally, but it does make the JSON files harder to
hand off to translators. **Pick the right one.**

| Namespace | What goes here | Example keys |
|---|---|---|
| `common` | UI chrome shared across many routes — buttons, navigation, footer, language switcher, generic errors. **This is the default namespace** and ships in the initial SSR bundle. | `common.buttons.save`, `common.errors.unknown`, `common.languageSwitcher.label` |
| `roster` | The car-line / bingo board, viewer board, mobile caller view, anything related to the live pickup flow. | `roster.spaceActive`, `roster.markEmpty`, `roster.kidsWaiting_one` |
| `admin` | Anything inside `app/routes/admin/**` — dashboard, children, drills, branding, history. | `admin.children.addButton`, `admin.drills.libraryHeading` |
| `billing` | Pricing page, billing portal, plan-limit banners, Stripe-flow copy. (Stripe receives `locale` separately — see Phase 2 Agent C scope.) | `billing.plan.carLine.name`, `billing.usage.overLimit` |
| `auth` | Login, signup, forgot-password, reset-password, set-password, error boundaries that mention auth state. | `auth.login.title`, `auth.errors.invalidCredentials` |
| `email` | Server-rendered email subjects + bodies (welcome, password reset, trial check-in, trial expiring). | `email.welcome.subject`, `email.passwordReset.body` |

**One file per namespace per language.** Don't subdivide further (e.g.
`admin/children.json`) — too many files become a load problem on Workers
and a mental-model problem for translators.

---

## Key naming convention

Format: `<namespace>:<feature>.<element>`

- Lower-case namespace + feature.
- camelCase leaf segment.
- Use `.` as the segment separator. The full key, after the colon, never
  contains another colon.

Examples — good:

```ts
t("admin:children.addButton")              // "Add child"
t("auth:login.passwordPlaceholder")         // "Enter your password"
t("roster:viewerBoard.legendTitle")         // "Legend"
t("billing:planLimits.studentsOverCap")     // "{{count}} students over cap"
t("common:buttons.cancel")                  // "Cancel"
```

Examples — bad:

```ts
t("admin:Add Child")                  // sentences-as-keys, forbidden
t("admin:children-add-button")        // kebab-case, inconsistent
t("Add child")                         // no namespace, dumps into common
t("admin:children.add_button")        // snake_case leaf, forbidden
```

**Why the rule:** key collisions are easy when keys read like sentences
("Sign in" appears on the login page *and* in the marketing header). And
when the source string changes ("Sign in" → "Log in"), the *key* should
not — that defeats the point.

---

## Interpolation

Use i18next placeholders, never template literals.

```ts
// JSON:                          // "pickedUpBy": "Picked up by {{name}}"
t("roster:event.pickedUpBy", { name: parent.name });

// JSX:
<p>{t("admin:students.count", { count: 42 })}</p>
```

Values are passed as a plain object. Keys are interpolated as `{{name}}`.

Forbidden patterns:

```ts
// Concatenation defeats translation order — Spanish word order won't match.
t("roster:pickedUpBy") + " " + parent.name;          // NO

// Template literals break i18next-parser extraction.
t(`roster:${field}.label`);                           // NO
```

The one place dynamic key construction is OK is when you have a finite,
known-at-extraction-time set of keys and you list them explicitly with
`// @ts-ignore`-style comment hints to the parser. Ask before doing this.

---

## Plurals

Use i18next's `count` parameter. Define `_one` / `_other` keys (and any
language-specific extras when we add them); never branch in component
code.

```json
// public/locales/en/roster.json
{
  "kidsWaiting_one": "{{count}} child waiting",
  "kidsWaiting_other": "{{count}} kids waiting"
}
```

```ts
t("roster:kidsWaiting", { count: queue.length });
// queue.length === 1  → "1 child waiting"
// queue.length === 7  → "7 kids waiting"
```

**Forbidden:**

```ts
queue.length === 1
  ? t("roster:kidsWaiting_one", { count: 1 })
  : t("roster:kidsWaiting_other", { count: queue.length });
```

(Some languages have more than two plural forms — that's why we don't
encode the branch in JS.)

---

## Declaring namespaces on a route

The `common` namespace ships with every render. Anything else is loaded
lazily; declare it via the route's `handle` export:

```ts
// app/routes/admin/children.tsx
export const handle = { i18n: ["admin"] };
```

Multiple namespaces are fine:

```ts
export const handle = { i18n: ["admin", "billing"] };
```

`useTranslation` reads from these implicitly:

```ts
const { t } = useTranslation("admin");
return <button>{t("children.addButton")}</button>;
// or, with a fully-qualified key:
return <button>{t("admin:children.addButton")}</button>;
```

The lazy-loader (configured in `app/i18n.ts`) fetches the JSON from
`/locales/<lng>/<ns>.json` on first use. The fetch is cached by i18next.

---

## How locale flows through a request

1. **Detector chain** — runs in `app/i18n.server.ts:detectLocale`.
   Priority order: `lng` cookie → `User.locale` → `Org.defaultLocale` →
   `Accept-Language` → `en`.
2. **Root loader** — `app/root.tsx` calls `detectLocale(request, context)`
   and returns `{ locale, i18nResources }` to children.
3. **Root component** — calls `useChangeLanguage(locale)` from
   `remix-i18next/react`, which keeps i18next pinned to the loader value.
4. **Children** — call `useTranslation()` and don't have to think about
   it. The active language matches `<html lang>`.

To read the locale outside of a `useTranslation` call (rare):

```ts
const { i18n } = useTranslation();
const locale = i18n.language; // "en" | "es"
```

To read the locale on the server (e.g. inside a sibling loader):

```ts
import { detectLocale } from "~/i18n.server";
const locale = await detectLocale(request, context);
```

---

## Print routes

The three print routes (`print.board`, `print.master`,
`print.homeroom.$teacherId`) **don't** follow the user's locale. Their
audience is the printout's reader, not the admin clicking Print.

Rule:

| Route | Locale source |
|---|---|
| `print.board`               | `org.defaultLocale` |
| `print.master`              | `org.defaultLocale` |
| `print.homeroom.$teacherId` | `teacher.locale` if set, else `org.defaultLocale` |

The loader resolves this and puts it in returned data; the component
calls `usePrintLocale` to read it:

```ts
// app/routes/admin/print.homeroom.$teacherId.tsx
import { getTeacherPrintLocale } from "~/i18n.server";
import { usePrintLocale } from "~/hooks/usePrintLocale";

export async function loader({ params, context }: Route.LoaderArgs) {
  const printLocale = await getTeacherPrintLocale(context, params.teacherId);
  // ... existing data lookups ...
  return { printLocale, teacher, students };
}

export const handle = { i18n: ["admin"] };

export default function PrintHomeroom({ loaderData }: Route.ComponentProps) {
  const printLocale = usePrintLocale("homeroom", loaderData.teacher.id);
  const { t } = useTranslation("admin", { lng: printLocale });
  return (
    <main lang={printLocale}>
      <h1>{t("print.homeroom.title", { name: loaderData.teacher.homeRoom })}</h1>
      {/* ... */}
    </main>
  );
}
```

---

## Server-side `t` usage

Outside React (email templates, Zod errors, thrown `Response` messages):

```ts
import { getFixedT } from "~/lib/t.server";

// Inside an email template builder:
async function buildWelcomeEmail(user: { name: string; locale: string }) {
  const t = await getFixedT(user.locale, "email");
  return {
    subject: t("welcome.subject"),
    body: t("welcome.body", { name: user.name }),
  };
}
```

`getFixedT` accepts either a single namespace string or an array. It
returns a fresh i18next instance per call (no shared state across
requests on the worker isolate) — cheap on cold-paths, fine for the
volume we hit.

---

## Zod errorMap pattern (decision: per-schema map)

We chose option (b) from the plan: **per-schema error maps** rather than
a global `z.setErrorMap`. Reasoning:

- Existing form parsers in `app/lib/forms.server.ts` already produce
  `dataWithError(...)` toasts at the route boundary — translating there
  is the natural fit.
- A global error map runs everywhere zod runs (including server-side
  data validation that never surfaces to a user) — overkill.
- Per-schema maps let us pass `lng` explicitly, which composes well with
  the detector chain.

Helper:

```ts
// app/lib/zod-error-map.server.ts (Phase 2 Agent C will own this)
import { type z } from "zod";
import { getFixedT } from "~/lib/t.server";

export async function makeZodErrorMap(lng: string): Promise<z.ZodErrorMap> {
  const t = await getFixedT(lng, "common");
  return (issue, ctx) => {
    switch (issue.code) {
      case "too_small":
        return { message: t("errors.tooSmall", { min: issue.minimum }) };
      case "invalid_type":
        return { message: t("errors.required") };
      // ... etc.
      default:
        return { message: ctx.defaultError };
    }
  };
}
```

Use site:

```ts
const errorMap = await makeZodErrorMap(await detectLocale(request, context));
const result = schema.safeParse(formData, { errorMap });
```

Phase 2 Agent C is the canonical owner of the full error map. Until that
lands, route actions can keep using the existing default messages — they
just won't be translated yet.

---

## How to add a new language

Worked example: adding French (`fr`).

1. **Add it to the supported list.** In `app/lib/i18n-config.ts`:
   ```ts
   export const SUPPORTED_LANGUAGES = [
     { code: "en", nativeName: "English" },
     { code: "es", nativeName: "Español" },
     { code: "fr", nativeName: "Français" }, // new
   ] as const;
   ```
2. **Mirror the JSON tree.** Create `public/locales/fr/{common,roster,admin,billing,auth,email}.json`,
   each as `{}`. Run `npm run i18n:extract` to populate empty keys.
3. **Add the bundled imports.** In `app/lib/t.server.ts` add the six
   `import frCommon from "...";` lines and an `fr: { ... }` entry in the
   `resources` object. (This is the static-import workers-runtime path —
   don't try to read from disk at request time.)
4. **Add the initial bundle.** In `app/root.tsx` add `fr: frCommon` to
   `COMMON_BUNDLES`.
5. **Translate.** Hand the JSON files to a translator. Maintain
   `docs/i18n-glossary.md` (Phase 3) for school-domain consistency.
6. **Smoke test.** Force `lng=fr` cookie, walk the major routes, watch
   for English leaks.

The `LanguageSwitcher` and `/api/user-prefs` validator pick up the new
language automatically — both read from `SUPPORTED_LANGUAGES`.

---

## Data we never translate

Translate UI chrome only. Treat anything entered by an end-user (admin,
teacher, parent) as opaque.

Forbidden — user-generated:

- Student first/last names
- Homeroom names ("3-A", "Mrs. Smith's class")
- Org / school names
- Custom drill names
- Parent names in pickup events
- Branding text overrides (these are tenant-customized)

Allowed — UI chrome:

- Button labels, headings, form labels, placeholders
- Toast messages, error messages from our code
- Email subjects/bodies (with `{{name}}` interpolation for the user's
  name — the *value* `name` isn't translated, only the surrounding text)
- Marketing pages, footer, navigation
- Plan / billing copy
- Print-route labels (date headers, "Bus loop", "Walker", etc.)

When in doubt: would a translator be able to translate this without
knowing the school's roster? If no, it's data, not chrome.

---

## Before / after — small button label

Before (`app/components/Header.tsx`, hypothetical fragment):

```tsx
<Link to="/admin">Admin</Link>
<Link to="/logout">Logout</Link>
```

After:

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation("common");

<Link to="/admin">{t("nav.admin")}</Link>
<Link to="/logout">{t("nav.logout")}</Link>
```

`public/locales/en/common.json`:

```json
{
  "nav": {
    "admin": "Admin",
    "logout": "Log out"
  }
}
```

`public/locales/es/common.json`:

```json
{
  "nav": {
    "admin": "Administrador",
    "logout": "Cerrar sesión"
  }
}
```

---

## Before / after — form with placeholders, errors, and a dynamic count

Before (hypothetical login route):

```tsx
export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const remaining = 3;

  return (
    <form>
      <h1>Sign in</h1>
      <label>
        Email
        <input type="email" placeholder="you@school.edu" />
      </label>
      <label>
        Password
        <input type="password" placeholder="Your password" />
      </label>
      <button type="submit">Sign in</button>
      {error && (
        <p>Invalid credentials. {remaining} attempts remaining.</p>
      )}
    </form>
  );
}
```

After:

```tsx
import { useTranslation } from "react-i18next";

export const handle = { i18n: ["auth"] };

export default function Login() {
  const { t } = useTranslation("auth");
  const [error, setError] = useState<string | null>(null);
  const remaining = 3;

  return (
    <form>
      <h1>{t("login.title")}</h1>
      <label>
        {t("login.emailLabel")}
        <input
          type="email"
          placeholder={t("login.emailPlaceholder")}
        />
      </label>
      <label>
        {t("login.passwordLabel")}
        <input
          type="password"
          placeholder={t("login.passwordPlaceholder")}
        />
      </label>
      <button type="submit">{t("login.submit")}</button>
      {error && (
        <p>
          {t("login.invalidCredentials")}{" "}
          {t("login.attemptsRemaining", { count: remaining })}
        </p>
      )}
    </form>
  );
}
```

`public/locales/en/auth.json`:

```json
{
  "login": {
    "title": "Sign in",
    "emailLabel": "Email",
    "emailPlaceholder": "you@school.edu",
    "passwordLabel": "Password",
    "passwordPlaceholder": "Your password",
    "submit": "Sign in",
    "invalidCredentials": "Invalid credentials.",
    "attemptsRemaining_one": "{{count}} attempt remaining.",
    "attemptsRemaining_other": "{{count}} attempts remaining."
  }
}
```

Notice:

- `<h1>Sign in</h1>` and `<button>Sign in</button>` map to **different**
  keys (`login.title` and `login.submit`) even though the source string
  is the same. They might diverge in translation — Spanish capitalizes
  "Iniciar sesión" identically in both places, but other languages
  (German for instance) often capitalize button labels differently. Don't
  collapse them.
- `attemptsRemaining` ships as plural variants and is called with `count`.
- The route declared `auth` in `handle.i18n` so the namespace lazy-loads.

---

## Cookie / DB columns reference

| Surface | Name | Notes |
|---|---|---|
| Cookie | `lng` | 1-year expiry, `SameSite=Lax`, `Path=/`. |
| `User.locale` | `String` (default `"en"`) | Per-user UI preference. |
| `Org.defaultLocale` | `String` (default `"en"`) | Tenant fallback + print views. |
| `Teacher.locale` | `String?` | Optional homeroom-print override. |

Migration: `migrations/0022_add-locale-fields.sql`.

---

## Out of scope (for Phase 1 + Phase 2)

- URL-based locale routing (`/es/admin/...`).
- RTL languages.
- Localized currency / date formats beyond `Intl.*` defaults.
- Translating Better-auth internals upstream (we map at the boundary —
  Phase 2 Agent C).
- Translating server logs / Sentry / admin-only debug surfaces.

---

## Server-side message contract

Server-domain functions (anything under `app/domain/**`) MUST NOT call
`t()` themselves — by the time they run, the request locale has already
been resolved at the route boundary, and translating in two places is
exactly how copy ends up half-Spanish. Instead, server functions return
**translation-ready** objects: a fully-qualified i18next key plus an
optional params bag for interpolation.

Canonical types live in `app/domain/types/server-message.ts`:

```ts
export type ServerMessage = {
  key: string;                                      // e.g. "errors:households.invalidRoom"
  params?: Record<string, string | number>;
};

export type ServerResult<T> =
  | { ok: true; data: T; successMessage?: ServerMessage }
  | { ok: false; error: ServerMessage };
```

### How callers use it

The route action / loader wrapper resolves the message:

```ts
import { detectLocale } from "~/i18n.server";
import { getFixedT } from "~/lib/t.server";
import { dataWithError, dataWithSuccess } from "remix-toast";

export async function action({ request, context }: Route.ActionArgs) {
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, ["admin", "errors"]);

  const result = await createHousehold({ prisma, orgId, formData });

  if (!result.ok) {
    return dataWithError(null, t(result.error.key, result.error.params ?? {}));
  }
  if (result.successMessage) {
    return dataWithSuccess(
      result.data,
      t(result.successMessage.key, result.successMessage.params ?? {}),
    );
  }
  return { ok: true, data: result.data };
}
```

### Action outcomes with three flavours

The admin-users action handler returns an `AdminUsersActionOutcome`
(success / warning / error variants, all carrying a `ServerMessage`).
The route boundary picks the right `dataWith*` helper:

```ts
function dataWithToast(outcome: AdminUsersActionOutcome, t: TFunction) {
  const message = t(outcome.message.key, outcome.message.params ?? {});
  if (outcome.kind === "success") return dataWithSuccess(outcome.data, message);
  if (outcome.kind === "warning") return dataWithWarning(outcome.data, message);
  return dataWithError(outcome.data, message);
}
```

### Per-row validation messages

For things that produce many errors (CSV import row-by-row), keep the
`{ row, message }` shape but make `message` a `ServerMessage`:

```ts
export type RosterRowError = {
  row: number;
  message: ServerMessage;
};
```

The route boundary maps over the array and calls
`t(error.message.key, error.message.params ?? {})` per row.

### Internal logs stay English

`console.error`, audit-log strings, Sentry breadcrumbs, dev-tools panels
— anything that doesn't surface to an end user — stays in English.
Translation overhead for engineering surfaces is pure cost.

### Where keys live

| Sub-tree under `errors:*` | Owner / consumer |
|---|---|
| `errors.adminUsers.*`     | `app/domain/admin-users/*.server.ts` (most keys reuse `admin:users.*`) |
| `errors.households.*`     | `app/domain/households/households-actions.server.ts` |
| `errors.csvImport.*`      | `app/domain/csv/roster-import.server.ts` |
| `errors.roi.*`            | `app/domain/dismissal/roi.server.ts` |

When a server function naturally maps to an existing namespace key (e.g.
`admin:users.errors.notFound`), reuse the namespaced key directly
instead of duplicating it under `errors.*`.

### Throwing vs returning

Prefer returning `{ ok: false, error }` over throwing. Two reasons:

1. Throwing forces the route boundary to catch + introspect the error —
   the contract is harder to enforce.
2. Type narrowing on `ServerResult<T>` gives the route's TypeScript a
   strong signal about which branch carries `data` vs `error`.

When deeper code (Prisma client, Better-auth) does throw, wrap the
public function boundary in `try/catch` and convert:

```ts
try {
  return { ok: true, data: await prisma.thing.create(...) };
} catch (e) {
  return {
    ok: false,
    error: {
      key: "errors:something.unexpected",
      params: { detail: e instanceof Error ? e.message : String(e) },
    },
  };
}
```

The translated string controls how `{{detail}}` is surfaced — most
end-user copy quietly drops it; admin-only diagnostics may include it
verbatim.

---

## Questions / contradictions

If anything in this doc disagrees with the live code, the **doc wins** —
file an issue. The code may have drifted; this doc is the contract three
parallel agents are working against.
