# Drill audience visibility

Date: 2026-04-27
Status: Approved (design); plan + implementation pending

## Problem

Three behaviors around live drills are wrong today:

1. **Magic-code viewers (viewer-pin guests) are NOT redirected to the live
   drill takeover.** The `root.tsx` redirect at line 144 fires only when
   `userContext.user` is non-null. Viewer-pin guests are a parallel auth
   concept (separate `pickuproster_viewer_session` cookie, no `User` row),
   so they slip through and continue to see the normal car-line board even
   while a fire drill is live.
2. **Admins have no way to scope a live drill's audience.** Every live
   drill is visible to everyone. For something like a lockdown, admins
   may want only staff to see the drill while parents/visitors with a
   viewer PIN continue to see the normal board, undisturbed and
   uninformed.
3. **Per-cell autosave fires a "Saved" toast on every toggle/note flush.**
   On a fast-clicking checklist this stacks 5–10 toasts in seconds, which
   is noise rather than signal.

## Goal

- Let admins choose, per drill template (default) and per drill run
  (override), whether a live drill is `STAFF_ONLY` or `EVERYONE`.
- Redirect every user who is in the audience — staff and (when
  applicable) viewer-pin guests — to `/drills/live`. Users not in the
  audience continue to use the app normally with no indication a drill
  is happening.
- Replace the per-save success toast with a small inline "Saving…/Saved"
  indicator on the live drill page.

## Non-goals

- Mid-drill audience changes. Once a drill is LIVE or PAUSED, audience is
  frozen. Changing it would force-eject viewers mid-drill or pull new
  ones in mid-event; messy and not worth the complexity.
- Per-user or per-role-tier (TEACHER vs ADMIN) audience picking. Two
  tiers (`STAFF_ONLY` vs `EVERYONE`) is enough for the lockdown-vs-fire
  use case the user described.
- Audience-aware history/replay UI. The `/admin/drills/history/:runId`
  page is admin-only and shows everything; no change.

## Data model

One column on `DrillTemplate`, one column on `DrillRun`. New d1 migration
file (next number is `0029`).

```prisma
model DrillTemplate {
  // existing fields...
  // "STAFF_ONLY" | "EVERYONE". Default audience pre-selected on the
  // start-live confirmation when this template is launched.
  defaultAudience String @default("EVERYONE")
}

model DrillRun {
  // existing fields...
  // "STAFF_ONLY" | "EVERYONE". Frozen at start-time. Backfilled to
  // "EVERYONE" so historical runs match today's behavior.
  audience String @default("EVERYONE")
}
```

Backfill: both columns default to `"EVERYONE"`, which preserves
pre-feature behavior (every signed-in user + every viewer-pin guest gets
redirected to a live drill).

A narrow TypeScript union `DrillAudience = "STAFF_ONLY" | "EVERYONE"`
lives in `app/domain/drills/types.ts` alongside the existing
`DrillRunStatus` etc., with parse/guard helpers in the same shape.

## Audience membership

The redirect logic decides "is this caller in the audience" from a small
enum, not from `User.role`, because viewer-pin guests don't have a role:

```ts
type AudienceMembership = "STAFF" | "VIEWER_PIN" | "NONE";
```

- `STAFF`: any signed-in `User` belonging to the org (ADMIN, CONTROLLER,
  TEACHER, VIEWER role users — all of them are "staff" for this gate).
  The `VIEWER` role on `User` is a real-account low-permission role and
  is unrelated to the magic-code viewer-pin concept.
- `VIEWER_PIN`: anonymous (no `User`) but `hasValidViewerAccess` returns
  true.
- `NONE`: anonymous with no viewer cookie.

Audience matrix:

| Drill audience | STAFF | VIEWER_PIN | NONE |
|----------------|-------|------------|------|
| `STAFF_ONLY`   | ✅    | ❌          | ❌    |
| `EVERYONE`     | ✅    | ✅          | ❌    |

Anonymous unauthenticated callers are never redirected to a takeover —
they get the existing auth flows.

## Redirect logic

Replace `userIsAdmin` exemption in
`app/domain/drills/live-redirect.server.ts` with audience-membership
checking. The pure function signature changes to:

```ts
export interface LiveRedirectInput {
  membership: AudienceMembership;
  audience: "STAFF_ONLY" | "EVERYONE" | null;  // null = no active drill
  pathname: string;
}

export function liveDrillRedirectTarget(
  input: LiveRedirectInput,
): string | null;
```

Returns `"/drills/live"` if:

- `audience` is non-null (drill is live or paused) AND
- caller is in the audience per the matrix above AND
- `pathname` is not in the allow-list.

`ALLOW_PATHS` and `ALLOW_PREFIXES` keep their existing entries
(`/drills/live`, `/logout`, `/set-password`, `/api/`, `/assets/`,
`/build/`). **One new entry: `/admin/`** added to `ALLOW_PREFIXES` so
admins can still reach admin pages mid-drill (e.g., to fix billing,
manage roster) without the takeover stealing every navigation. They are
still redirected on first arrival (e.g., loading `/`), which is the
intended takeover behavior.

In `root.tsx` the loader changes to:

1. If marketing host → skip (unchanged).
2. Compute `membership`:
   - `userContext.user` non-null and in this org → `STAFF`
   - else `await hasValidViewerAccess(...)` → `VIEWER_PIN` if true
   - else `NONE`
3. If `membership === "NONE"` → skip the DB lookup entirely (preserves
   today's "anonymous never pays for the drill query" behavior).
4. Else fetch `getActiveDrillRun(prisma, org.id)` and call
   `liveDrillRedirectTarget`.

The `getActiveDrillRun` return type already reads the `DrillRun.audience`
column (added by the migration); the loader passes its value through.

## Live drill page (`/drills/live`)

Loader gains an audience check:

- If no active run → redirect to `/` (unchanged).
- Else compute membership exactly as in `root.tsx`.
  - `STAFF` → always allowed in.
  - `VIEWER_PIN` → allowed only if `run.audience === "EVERYONE"`. If
    `STAFF_ONLY`, throw a 404 `Response`. (404, not 401, because logging
    in does not change the outcome — they just don't have access.)
  - `NONE` → existing 401 path is preserved.
- Returns `audience` to the component for the banner badge.

The red banner gets a small badge:

> `LIVE — Fire drill · Everyone` (or `Staff only`)

Read-only, informational. No mid-run audience editing.

## Per-save toast → inline "Saving…/Saved" indicator

`drills.live.tsx` action: change line 170 from
`return dataWithSuccess(null, t("drillsLive.toasts.saved"))` to
`return data(null)`. Keep `pause`/`resume`/`end` success toasts and all
error toasts.

Component: a small status pill near the checklist heading.

State derived from `fetcher`:

- `fetcher.state !== "idle"` → "Saving…" with spinner icon.
- After fetcher returns successfully (no error in `fetcher.data`), set
  `lastSavedAt = Date.now()` and show "Saved · just now" for 1500ms,
  then fade to nothing.
- If `fetcher.data` carries an error toast, the existing toast
  pipeline shows it; the indicator returns to idle.

Indicator is unstyled-by-default (text + lucide icon). No new component
file needed — inline in `drills.live.tsx`.

i18n: drop the `drillsLive.toasts.saved` key. Add
`drillsLive.savedIndicator.{idle,saving,saved}` keys to
`public/locales/{en,es}/roster.json`.

## Admin UI changes

### Per-template default

On `/admin/drills/$templateId` (the template editor), add a single radio
group above or below the existing fields:

> **Audience for live runs** *(default for new starts; admin can override
> when starting)*
>
> ( ) Staff only — only signed-in staff see the drill takeover
> (•) Everyone — staff and viewer-pin guests see the drill takeover

Saved as `defaultAudience` on `DrillTemplate`.

### Per-run override at start-live

The "Start live drill" button (red button on the template editor and on
each row of `/admin/drills`) currently posts directly. Convert it into a
two-step interaction:

1. Click "Start live drill" → small inline confirm popover (HeroUI
   `Popover`) appears with:
   - Heading: "Start live drill"
   - Audience radio group, defaulted to template's `defaultAudience`
   - Confirm button (red, "Start live drill")
2. Confirm submits the `start-live` intent with `audience` form field.

`startDrillRun(prisma, orgId, templateId, undefined, actor, audience)`
gains a fifth `audience` parameter; writes it to `DrillRun.audience`.
Existing 409 "another live drill" path unchanged.

### History page

`/admin/drills/history/:runId` shows the audience badge alongside the
status — purely informational, no edit.

## Files touched

New:

- `migrations/0029_drill_audience.sql` — adds two columns with defaults.

Edited:

- `prisma/schema.prisma` — add `defaultAudience` and `audience`.
- `app/domain/drills/types.ts` — `DrillAudience` union + parser.
- `app/domain/drills/live.server.ts` — `startDrillRun` accepts audience;
  `getActiveDrillRun` returns it.
- `app/domain/drills/live-redirect.server.ts` — replace `userIsAdmin`
  branch with membership-based gate; new types.
- `app/domain/drills/live-redirect.server.test.ts` — rewrite test cases
  around the membership matrix + `STAFF_ONLY`/`EVERYONE` cases.
- `app/root.tsx` — compute membership (user OR viewer-pin), pass
  through.
- `app/routes/drills.live.tsx` — drop "Saved" toast, add inline
  indicator, audience badge in banner, audience-gated 404 for excluded
  viewers.
- `app/routes/admin/drills.tsx` — start-live action accepts audience;
  per-row start-live button → confirm popover.
- `app/routes/admin/drills.$templateId.tsx` — `defaultAudience` radio
  group; saves with template.
- `app/routes/admin/drills.history.$runId.tsx` — show audience badge
  (read-only).
- `public/locales/en/roster.json`, `public/locales/es/roster.json` —
  drop `drillsLive.toasts.saved`; add
  `drillsLive.savedIndicator.{idle,saving,saved}`,
  `drillsLive.audience.{everyone,staffOnly}`,
  `admin.drills.startConfirm.*`.

## Tests

- `live-redirect.server.test.ts` — new cases:
  - STAFF + STAFF_ONLY drill → redirect
  - STAFF + EVERYONE drill → redirect
  - VIEWER_PIN + STAFF_ONLY drill → no redirect
  - VIEWER_PIN + EVERYONE drill → redirect
  - NONE + any drill → no redirect
  - STAFF + EVERYONE drill on `/admin/X` → no redirect (allow-list)
- `live.server.test.ts` — `startDrillRun` writes audience; default
  fallback to `defaultAudience` when caller omits.
- `drills.live.tsx` integration (Node `--test`):
  - VIEWER_PIN cookie + STAFF_ONLY run → 404
  - STAFF + STAFF_ONLY run → renders
- A small Playwright test under `e2e/` covering the start-live confirm
  popover and the resulting audience badge in the banner. Reuse the
  existing drills e2e harness.

## Migration order

`0029_drill_audience.sql`:

```sql
ALTER TABLE DrillTemplate ADD COLUMN defaultAudience TEXT NOT NULL DEFAULT 'EVERYONE';
ALTER TABLE DrillRun      ADD COLUMN audience        TEXT NOT NULL DEFAULT 'EVERYONE';
```

D1 supports `ALTER TABLE ADD COLUMN` with a constant default. Both
columns default to `EVERYONE`, so:

- All historical drills are still visible to "everyone" in the audit
  badge (matches what they actually were — no audience gating existed).
- Existing templates inherit `EVERYONE` until an admin explicitly sets
  the radio.

No backfill script needed.

## Open risks

- **Admin allow-list expansion (`/admin/`).** If we add `/admin/` to
  `ALLOW_PREFIXES`, an admin who *wants* to be in the takeover (e.g.,
  TEACHER role briefly toggled to ADMIN) will not be force-redirected
  when navigating admin pages. They'll still get the takeover on `/`
  and on the home board, which is the canonical entry point. Risk is
  low; the alternative (admins fully stuck in the takeover) is worse.
- **Spanish strings.** Adding new i18n keys means both en + es JSON
  must be updated together; CI lint catches missing keys.
- **`getActiveDrillRun` signature change.** Adds `audience` to its
  return type. Anywhere that destructures it must be updated.

## Rollout

Single PR. The migration is additive with safe defaults; no separate
"deploy schema then code" two-step is needed.
