# District-level multi-tenancy — design

**Date:** 2026-04-25
**Status:** Approved for implementation planning
**Owner:** Noah

## 1. Summary

Add a `District` entity that owns billing for a contracted set of schools. Districts have their own admin portal at `pickuproster.com` (role-routed from the same login as everyone else), see aggregate dashboards across their schools, and can impersonate into a school to act as a school admin (with audit logging). School admins never see billing or district-level controls. Districts are sales-touched at the contracted level, but a self-serve flow lets a district sign up, provision schools, and invite school admins immediately during the trial.

The existing single-school `Org` model continues to work unchanged for non-district customers.

## 2. Goals (v1)

- Districts are the billing parent: one Stripe customer / one subscription / one invoice for N contracted schools.
- District admins log in at `pickuproster.com` and are role-routed to a `/district` portal.
- District portal shows aggregate dashboards (school list with per-school usage, district rollup metrics, billing summary).
- District admins can impersonate into any school in their district through one gated entry point with audit logging.
- School admins do not see billing UI or district controls.
- School provisioning by a district reuses the existing onboarding pipeline (default board, classrooms, settings) so a school admin lands on a working board.
- Soft school cap: districts can exceed `schoolCap` but are flagged on the platform staff panel.
- Sales (platform staff) controls trial end dates, school cap, comp status, and billing notes from a Districts section in the staff panel.

## 3. Non-goals (v1)

- Per-student aggregate metering or pooled plan caps.
- Self-serve "request more schools" or automated Stripe overage line items.
- District-level custom domain or theme color overrides (logo only).
- Migration of existing standalone orgs into districts. Greenfield only — DB wipe pre-launch is acceptable.
- Memberships table or multi-scope users. A user is exactly one of: school admin, district admin, or platform admin.
- Drill-down read-only access for district admins. The only path into per-school data is the impersonation gate.

## 4. Pricing model (reference, not implementation)

- District plan: per-school flat (default anchored to CAMPUS price × N schools), sales-negotiable.
- Add-on capacity packs (any tier): +$10/mo per additional 200 students / 60 families / 10 classrooms. Sales adds line items in Stripe; arbitrary line items allowed.
- Marketing / pricing-page note: "Mid-school-year sign-ups and budget-constrained small private schools — mention it during your free trial and we'll work with you on pricing." This is copy on the marketing site, not a code feature.

## 5. Data model

### 5.1 New `District` table

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String (cuid) | PK |
| `name` | String | |
| `slug` | String | Unique. Used in staff panel URLs (`/admin/districts/:slug`) and reserved for future district custom domain. Customer-facing district URLs are not slug-based in v1 (the district portal is at `/district` and is contextual on `User.districtId`). |
| `logoUrl` | String? | |
| `logoObjectKey` | String? | |
| `status` | `OrgStatus` | Reuse existing enum (ACTIVE / TRIALING / PAST_DUE / SUSPENDED / INCOMPLETE / CANCELED) |
| `schoolCap` | Int | Default 3. Soft cap, set by sales contract |
| `stripeCustomerId` | String? | Unique |
| `stripeSubscriptionId` | String? | Unique |
| `subscriptionStatus` | `StripeSubscriptionStatus`? | |
| `billingPlan` | `BillingPlan` | Default `DISTRICT` |
| `trialStartedAt` | DateTime? | Set on district creation |
| `trialEndsAt` | DateTime? | Sales-set; no auto-end |
| `pastDueSinceAt` | DateTime? | |
| `compedUntil` | DateTime? | |
| `isComped` | Boolean | Default false |
| `billingNote` | String? | Platform ops notes |
| `passwordResetEnabled` | Boolean | Default true |
| `defaultLocale` | String | Default `"en"` |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

Mirrors the existing per-org billing levers from [schema.prisma:60](../../../prisma/schema.prisma) so platform staff has the same toolset at the district level.

### 5.2 `Org` additions

- `districtId String?` — nullable FK to `District.id`. When set:
  - The org's own Stripe-related fields (`stripeCustomerId`, `stripeSubscriptionId`, `billingPlan`, `subscriptionStatus`, trial fields) are unused at runtime — billing flows through the district.
  - Plan caps still apply per-school. Each org inside a district inherits CAMPUS-tier limits (900 students / 300 families / 80 classrooms).
  - Per-school `Org.status` still applies (a single school inside a paid-up district can be `SUSPENDED` individually if staff need to).
- Index on `districtId` for the dashboard queries.

### 5.3 `User` additions

- `districtId String?` — nullable FK to `District.id`.
- App-level invariant: exactly one of `{districtId, orgId, isPlatformAdmin}` is set per user. Validated in better-auth user-create / user-update hooks. Prisma can't model XOR; same precedent as the LIVE/PAUSED `DrillRun` comment in `schema.prisma`.

### 5.4 New `DistrictAuditLog` table

Mirrors `OrgAuditLog`. Fields: `id`, `districtId`, `actorUserId?`, `actorEmail?`, `action`, `targetType?`, `targetId?`, `details` (JSON), `createdAt`.

Logged actions:
- `district.admin.invited`
- `district.admin.removed`
- `district.school.created`
- `district.school.cap.exceeded` (one entry per cross-over event)
- `district.impersonate.start` (details: `orgId`, `targetSlug`)
- `district.impersonate.end`
- `district.billing.note.changed` (by staff)
- `district.schoolCap.changed` (by staff)
- `district.trialEndsAt.changed` (by staff)
- `district.comp.changed` (by staff)

Visible to district admins (their own district's log) and to platform staff.

## 6. Auth & permissions

### 6.1 Login routing

Single login surface at `pickuproster.com` (existing better-auth flow, unchanged). After authentication, role-route based on the User row:

```
isPlatformAdmin == true       → /admin           (existing platform admin)
districtId set                → /district        (NEW district portal)
orgId set                     → existing per-org board / admin
otherwise                     → error / unassigned account
```

Routing happens in the post-login redirect handler. Routes for `/district/*` validate `User.districtId` is set; routes for the existing `/admin` (org) and board paths continue to validate `User.orgId`.

### 6.2 District admin scope

District admins have **no** access to per-school data through the normal tenant-scoped queries. The Prisma tenant-extension at [tenant-extension.ts:41](../../../app/db/tenant-extension.ts) stays unchanged — it scopes by request `orgId`. District admins make queries on a parallel surface:

- District-scoped reads: load `District` by `ctx.districtId`, list `Org` where `Org.districtId == ctx.districtId`.
- Aggregate reads: count / groupBy on tenant tables (Student, Household, Space, CallEvent, …) filtered through `Org.districtId`. These run on a Prisma client that does **not** have the tenant-extension applied (constructed via a `getDistrictDb(ctx.districtId)` helper). Every query in `district-scope.server.ts` must include an explicit `where: { org: { districtId: ctx.districtId } }` filter (or the equivalent join). Lint rule / code review checklist: any function in this module that hits a tenant table without that filter is a bug.

The tenant-extension is not weakened. District-admin code paths simply use a different Prisma client without the extension, and that client is only available inside `district-scope.server.ts`.

### 6.3 Impersonation gate

One controlled entry point:

- **Action:** `POST /district/schools/:orgId/impersonate`
- **Validates:**
  - Caller is a district admin (`User.districtId` set).
  - Target `Org.districtId == User.districtId`.
- **Effect:**
  - Writes `DistrictAuditLog` (action=`district.impersonate.start`, details `{orgId, targetSlug}`).
  - Stamps the session with `impersonatedOrgId`.
- **Session resolution:** The tenant-extension at [tenant-extension.ts:41](../../../app/db/tenant-extension.ts) is constructed per-request from an `orgId`. The per-request Prisma client builder is updated to pick `session.impersonatedOrgId` when set, otherwise `User.orgId`. So when impersonation is active, every existing tenant-scoped query automatically operates on the target school with no per-route changes. The user is treated as a school admin in that org for everything except the act of ending impersonation.
- **End:** `POST /district/impersonate/end` clears the stamp, writes `DistrictAuditLog` (action=`district.impersonate.end`).
- **UI indicator:** A persistent banner in the impersonated school's UI shows "You are impersonating as district admin [name] — End impersonation." Banner is rendered whenever `session.impersonatedOrgId` is set.

### 6.4 School admin scope (unchanged)

School admins (`User.orgId` set, `districtId` null) cannot reach `/district/*` routes (each route validates `User.districtId`). The school admin UI does not display billing routes when `Org.districtId` is set — billing is the district's responsibility, not the school's.

## 7. Provisioning flows

### 7.1 District signup (self-serve)

- New marketing route ("Sign up your district") posts to a district-create handler.
- Handler creates a `District` row with:
  - `status = TRIALING`
  - `schoolCap = 3` (default for self-serve)
  - `trialStartedAt = now`
  - `trialEndsAt = null` (sales sets it)
  - `billingPlan = DISTRICT`
- Creates the first district admin User (`districtId` set, `orgId` null, `isPlatformAdmin` false).
- Lands on empty district portal with "Add your first school" CTA.

### 7.2 District creates a school

- Form fields: school name + slug (slug must be unique across all `Org.slug` — same uniqueness constraint as today).
- If `district.schoolCount >= district.schoolCap`: school is still created (soft cap), and a banner is shown in the district portal: "You're over your contract — your account manager will be in touch." `DistrictAuditLog` records `district.school.cap.exceeded`. Platform staff sees the over-cap flag.
- On submit:
  - Create `Org` with `districtId` set, no Stripe fields, default `status = EMPTY`.
  - Run the existing onboarding pipeline (default board, default classrooms, default settings — whatever single-school signup currently does). **Do not fork the pipeline.** This guarantees a school admin lands on a working board.
  - Capture school-admin email, create the school admin User (`orgId` set, `districtId` null, `isPlatformAdmin` false), send invite email through the existing invite flow.
  - Write `DistrictAuditLog` action=`district.school.created`.

### 7.3 Adding district co-admins

- District admin invites another email; creates a User with `districtId` set, `orgId` null.
- Invite email reuses the existing template; landing on first login routes to `/district` based on `User.districtId`.
- `DistrictAuditLog` action=`district.admin.invited`.

## 8. Billing & trial

### 8.1 Stripe model

- District has its own Stripe customer + subscription. Stripe customer ID lives on `District.stripeCustomerId`.
- Subscription line items: per-school flat (default CAMPUS price × N schools), sales-negotiable. Sales can also add capacity-pack line items ($10/mo per +200 students / +60 families / +10 classrooms).
- Schools inside a district short-circuit Stripe lookups: any code path that today reads `Org.stripeCustomerId` / `Org.stripeSubscriptionId` returns early when `Org.districtId != null` (treat as "billed via district"). The existing per-org billing routes ([api/billing.checkout.ts](../../../app/routes/api/billing.checkout.ts), [api/billing.portal.ts](../../../app/routes/api/billing.portal.ts), [admin/billing.tsx](../../../app/routes/admin/billing.tsx)) hide themselves when `Org.districtId` is set.
- District billing UI lives at `/district/billing` (Stripe customer portal link, current plan summary, schoolCap, "Contact sales" CTA for cap changes).

### 8.2 Trial

- District created in `TRIALING` with `trialStartedAt = now`, `trialEndsAt = null`.
- Sales sets `trialEndsAt` from the staff panel after the conversation.
- No automatic cascade on trial expiry. When a district trial expires unpaid, the district itself goes `SUSPENDED` (district portal locked, can't add schools, can't impersonate). Child schools continue operating until staff explicitly suspends them.
- `compedUntil` / `isComped` / `billingNote` levers mirror the per-org behavior — staff editable from the staff panel.
- The existing per-org trial enforcement code at [trial-enforcement.server.ts](../../../app/domain/billing/trial-enforcement.server.ts) and [trial-expiry.server.ts](../../../app/domain/billing/trial-expiry.server.ts) is unchanged and continues to apply only to standalone orgs (orgs with `districtId == null`).

## 9. District portal UI (v1 surface)

### 9.1 Routes

- `/district` — dashboard (summary card + school list + rollup metrics)
- `/district/schools` — full schools table (same data as dashboard's school list, with filtering)
- `/district/schools/new` — create-school form
- `/district/schools/:orgId` — school detail (status, counts, last activity, "Open as admin" → impersonation, "Re-send school admin invite")
- `/district/admins` — district admin list + invite
- `/district/billing` — Stripe customer portal link, plan summary, schoolCap, "Contact sales"
- `/district/audit` — district audit log

### 9.2 Dashboard contents

**Summary card (top):**
- District name, plan tier, "X of Y schools," trial / billing status badge
- "Manage billing" button → Stripe customer portal session
- Over-cap banner if `schoolCount > schoolCap`

**School list table:**
- School name + slug
- Status badge (ACTIVE / TRIALING / PAST_DUE / SUSPENDED / EMPTY)
- Counts: students / families / classrooms each shown with cap fraction (e.g. "612 / 900 students")
- Last `CallEvent.createdAt`
- Plan-cap warning indicator (yellow ≥80% per [plan-limits.ts:2](../../../app/lib/plan-limits.ts), red ≥100%)
- Row actions: "Open as admin" (impersonation), "Re-send admin invite"

**District rollup card:**
- Total students / families / classrooms summed across schools
- Total `CallEvent` count last 7 days, last 30 days
- Active schools count (≥1 `CallEvent` in last 30 days)

All queries are live against the existing tables, grouped by `Org.districtId`. No rollup tables in v1 — districts have tens of schools, not thousands. Add caching if anything becomes slow.

### 9.3 District branding (v1)

District portal renders with default app chrome. `District.logoUrl` is shown in the portal header only. No district custom domain, no theme color overrides. Each school inside the district keeps its own existing branding fully independent.

## 10. Platform staff panel additions

A new Districts section in the existing platform admin panel (extends [platform-admin.server.ts](../../../app/domain/auth/platform-admin.server.ts)):

**Districts list:**
- Columns: name, slug, schoolCount, schoolCap, plan, status, billing status (subscriptionStatus), trial info
- Filter: "Over cap" (highlights districts where `schoolCount > schoolCap`)

**District detail page:**
- Edit `schoolCap`
- Set `trialEndsAt`
- Set `compedUntil` / `isComped`
- Edit `billingNote`
- Attach Stripe customer ID
- View audit log

**Admin script:**
- `reparentOrgToDistrict(orgId, districtId)` — ad-hoc helper (not exposed in UI). Used if sales needs to move an existing standalone org under a newly contracted district. Documented in `docs/runbooks/` (or equivalent) so platform staff knows it exists.

## 11. Component / file layout

New modules:

- `app/domain/district/district.server.ts` — district CRUD, schoolCap checks
- `app/domain/district/district-scope.server.ts` — aggregate queries (cross-org reads scoped by `Org.districtId`)
- `app/domain/district/impersonation.server.ts` — impersonation start/end, session stamping
- `app/domain/district/audit.server.ts` — `DistrictAuditLog` writes
- `app/routes/district/_layout.tsx` — district portal shell, role validation
- `app/routes/district/index.tsx` — dashboard
- `app/routes/district/schools._index.tsx`
- `app/routes/district/schools.new.tsx`
- `app/routes/district/schools.$orgId.tsx`
- `app/routes/district/schools.$orgId.impersonate.tsx` — POST handler
- `app/routes/district/impersonate.end.tsx` — POST handler
- `app/routes/district/admins.tsx`
- `app/routes/district/billing.tsx`
- `app/routes/district/billing.portal.tsx` — POST → create Stripe customer portal session for the district
- `app/routes/district/audit.tsx`
- `app/routes/admin/districts._index.tsx` — staff panel: districts list
- `app/routes/admin/districts.$slug.tsx` — staff panel: district detail (looked up by `District.slug`)
- `app/components/ImpersonationBanner.tsx` — persistent banner shown when `session.impersonatedOrgId` is set

Modifications:

- `prisma/schema.prisma` — `District`, `DistrictAuditLog`, `Org.districtId`, `User.districtId`
- Better-auth user-create / user-update hooks — XOR invariant validation
- Session resolution layer — honor `session.impersonatedOrgId` for the tenant-extension's effective `orgId`
- Login post-redirect handler — role-route to `/district` when `User.districtId` is set
- Per-org billing routes — early return / hide UI when `Org.districtId` is set
- New marketing landing route for district signup

## 12. Testing

**Unit tests:**
- User XOR invariant (rejects user create where 0 or ≥2 of `{districtId, orgId, isPlatformAdmin}` are set)
- `district-scope.server.ts` filters all reads by `ctx.districtId` (cross-district leakage tests)
- Impersonation start: writes audit, stamps session
- Impersonation end: clears stamp, writes audit
- School cap soft-enforcement: cap exceeded → school created + audit entry + banner flag

**Integration tests:**
- Cross-district isolation: district A admin cannot read district B's schools or aggregate metrics
- School admin cannot hit `/district/*` (returns 403 / redirect)
- District admin cannot read sibling district's audit log

**E2E (Playwright):**
- Full district signup flow → create first school → invite school admin → school admin signs in (separate browser context) → district admin impersonates → ends impersonation → audit log shows all events
- Soft-cap exceeded: district at cap creates one more school, banner appears in portal, staff panel shows over-cap flag

## 13. Migration

Single Prisma migration adds:

- `District` table with all columns above
- `DistrictAuditLog` table
- `Org.districtId` column + index
- `User.districtId` column + index

No data migration. Greenfield — the user has explicitly stated DB wipe pre-launch is acceptable. Standalone orgs continue to work; their `districtId` is null and the new code paths are no-ops for them.

## 14. Open considerations (deferred to v1.5+ if requested)

- District-level custom domain + theme overrides
- Self-serve "request more schools" flow with sales-quote integration
- Stripe overage automation when cap is exceeded
- Read-only drill-down for district admins (alternative to impersonation)
- Memberships table for users who are both district admin AND school admin of one school in their district
- Per-student aggregate metering with pooled caps
- Migration tooling to merge existing standalone orgs into newly contracted districts (currently a manual `reparentOrgToDistrict` script)
- DB-harness-backed cross-district isolation unit tests — v1 covers the user-visible path through the Playwright signup-and-cap E2E in `e2e/flows/district.spec.ts`. The plan's Task 9.2 is deferred to v1.5 because the existing test infra mocks `getPrisma(context)` and there's no in-memory Prisma harness yet for direct DB-backed isolation assertions.

## 15. Acceptance criteria

A district customer can:

1. Sign up at the district landing page and land in their portal.
2. Create a school by entering a name + slug; the school is fully provisioned (board, default classrooms, settings) and the school admin gets an invite email.
3. See an aggregate dashboard with per-school usage and district-rollup metrics.
4. Impersonate into any of their schools, act as a school admin, and end impersonation; every step audit-logged.
5. Exceed their `schoolCap` and see a "contact your account manager" banner; the over-cap state is visible to platform staff.
6. Pay one bill via the Stripe customer portal linked from `/district/billing`.

A school admin in a district school cannot:

1. See any billing UI on their school.
2. Reach any `/district/*` route.
3. Tell from regular use that they're inside a district (other than the impersonation banner when an admin pops in).

Platform staff can:

1. List all districts, filtered by over-cap status.
2. Edit `schoolCap`, `trialEndsAt`, `compedUntil`, `isComped`, `billingNote` per district.
3. Attach a Stripe customer to a district.
4. Run the `reparentOrgToDistrict` script if needed.
