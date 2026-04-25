# i18n post-merge handoff

The codex integration (billing-conversion + admin/users maintainability refactor +
roster onboarding + family/ROI/households) was merged into `master` on top of
your in-progress i18n WIP commit `b69ea19`. The merge was completed at commit
`7acbc4a`.

During conflict resolution, three files had heavy structural changes from the
codex side that overlapped with your t() wrapping. I took the codex side for
those — meaning your i18n wrappers were dropped on:

- `app/routes/auth/signup.tsx`
- `app/routes/admin/users.tsx` (mostly the action half — JSX still has t() calls)
- `app/routes/pricing.tsx`

Everywhere else your i18n changes survived (admin sidebar with new keys,
login.tsx, faqs.tsx, blog.$slug.tsx, marketing pages, the locale JSON files,
LanguageSwitcher, t.server.ts, i18n.server.ts, the `0022_add-locale-fields`
migration, etc.).

## Reference commit

Your original i18n versions of any file (with the t() calls intact) are in
commit `b69ea19`. Pull a stale file's previous wording with:

    git show b69ea19:app/routes/auth/signup.tsx

## What needs doing

### 1. Migration numbering collision (do first)

Both branches landed a `0022_*` migration:

- `migrations/0022_add-locale-fields.sql` (yours, i18n)
- `migrations/0022_family_exceptions_roi.sql` (codex)

Rename the locale-fields migration to `0023_add-locale-fields.sql` (or
whichever ordering you want — but they can't both be 0022). Update
`migrations/migration_lock.toml` if it pins a version.

### 2. Re-wrap stale strings

These files have i18n machinery (`useTranslation`, `handle = { i18n: [...] }`,
`getFixedT` in loader) already wired, but the JSX/loader bodies have bare
strings from the codex restructuring. Add t() calls and keys:

#### `app/routes/auth/signup.tsx`

The billing-conversion rewrite added a paid-plan flow that branches into Stripe
Checkout. New strings to translate include:
- All form labels for the email + org-name + slug + plan-cycle steps
- Plan-specific CTA copy ("Continue to checkout" vs "Start trial")
- Validation error strings returned from the action
- The cycle/plan summary panel

The original i18n version (in `b69ea19`) had 64 t() calls under the `auth`
namespace. Reuse those keys where the new copy is the same; add new keys to
`public/locales/{en,es}/auth.json` for the new billing-flow strings.

#### `app/routes/admin/users.tsx`

The JSX side (component body) is still mostly translated. The **action
handler** moved to `app/domain/admin-users/admin-users.server.ts` — that file
returns toast and error messages as plain strings and does **not** have i18n
wired. You'll need to either:
- pass a `t` function into the handler from the action loader, or
- have the handler return string keys + interpolation params and resolve in the
  action wrapper

The original `b69ea19` version had 78 t() calls; the relevant `users.toasts.*`
and `users.errors.*` keys are already in `public/locales/{en,es}/admin.json`.

#### `app/routes/pricing.tsx`

The billing-conversion rewrite added:
- A monthly/annual cycle picker (`billingCycleLabel`)
- A `CheckoutOrSignupCta` component that picks between signup and Stripe
  Checkout based on auth state
- A `priceForCycle` helper that emits `$X / month` and `$X / year` strings

None of this is wrapped. Add `useTranslation`, `handle = { i18n: ["billing"] }`
(or `marketing`), and a loader that emits localized `metaTitle` /
`metaDescription`. Add keys for the cycle picker labels, the CTAs ("Continue
to Signup" / "Continue to Stripe" / "Redirecting..."), and the per-period
helpers.

The i18n branch had a small language-count blurb on this page
(`marketing.languageCount`) — that key still exists in the locale files but
isn't currently rendered on master. Optional to re-add.

### 3. Brand-new codex files with no i18n

These didn't exist on the i18n branch and have zero translation wiring. Treat
them as net-new translation work:

- `app/routes/admin/households.tsx` — Households admin page (UI strings)
- `app/routes/admin/roster-import.tsx` — Roster import flow (UI strings,
  validation messages, success/error toasts)
- `app/domain/admin-users/admin-users.server.ts` — toast/error strings
  returned to `app/routes/admin/users.tsx` (see #2 above)
- `app/domain/households/households.server.ts` — error messages
- `app/domain/csv/roster-import.server.ts` — validation/parse error messages
- `app/domain/dismissal/roi.server.ts` — internal/admin error messages

`app/routes/admin/roster-template.csv.ts` is a CSV download — column headers
may need localization but the file itself is a pure data emitter.

### 4. Sidebar keys (already added — verify)

I added two keys to `public/locales/{en,es}/admin.json` under `sidebar.*` to
support the new admin entries codex added:

- `sidebar.households` — "Households"
- `sidebar.rosterImport` — "Roster Import"

The Spanish file got `[ES] Households` / `[ES] Roster Import` placeholders
matching your existing convention. Replace with real translations.

## Verify nothing else slipped

You can spot-check what changed in your i18n WIP commit vs what survived to
master with:

    git diff b69ea19 master -- 'app/**/*.tsx' 'app/**/*.ts' 'public/locales/**'

Anything that shows up as a removed `t(...)` call or a removed locale key on
the master side is something the codex merge dropped.
