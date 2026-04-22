# Pickup Roster — Implementation Plan

This is the master plan for the next big push. Each track is scoped to be runnable by a single subagent against a clean checkout. Tracks are ordered for dependency, but A/B/F can run in parallel; C is split into C1 (server) and C2 (UI) so they can also parallelize after A.

Conventions every subagent must follow:

- **React Router 7 patterns first.** Use `<Form method="post">` + `action` for mutations, `useFetcher` for inline updates, `useNavigation` / `fetcher.state` for pending UI, and browser-native APIs (FormData, URLSearchParams, Request, Response, Headers) instead of bespoke fetch wrappers. Route-colocated `loader` and `action` are the source of truth; client-only fetches to `/api/*` should be the exception, not the default.
- **Validation:** Use `zod` and `zod-form-data` (already installed) inside actions. Return `data({ error }, { status: 400 })` on failure; throw `redirect(...)` on success.
- **Types:** Always import the route's `Route` type via `./+types/<name>` and type loaders/actions/components with it.
- **Tenant scoping:** Mutations to tenant tables use `getTenantPrisma(context)`. Cross-tenant or auth/Org-level operations use `getPrisma(context)`.
- **Toasts:** Use `remix-toast`'s `redirectWithSuccess` / `redirectWithError` for action feedback (already wired in `root.tsx`).
- **Naming:** New env vars go in `env.d.ts` `Env` interface and `.dev.vars.example`; new public vars also go in `wrangler.jsonc` `vars`.
- **Tests:** When adding domain logic, add a sibling `*.test.ts` file using `node:test` (matches `npm run test` glob).

---

## Track A — Rebrand to Pickup Roster

**Goal:** Every user-visible string says "Pickup Roster" instead of "School Organizer". Support email is read from env with `support@pickuproster.com` as default.

### Files to change

- `app/lib/site.ts` — `DEFAULT_SITE_NAME = "Pickup Roster"`. Add `DEFAULT_SUPPORT_EMAIL = "support@pickuproster.com"` and a `getSupportEmail(context)` helper that reads `SUPPORT_EMAIL` env with the default fallback.
- `app/root.tsx` — replace hardcoded `"School Organizer — Car line"` (lines 120) and `<title>Error — School Organizer</title>` (line 112) with `DEFAULT_SITE_NAME`. Pass support email through root loader.
- `app/routes/pricing.tsx:7` — update meta title.
- `app/routes/auth/signup.tsx:20` — update meta title.
- `app/routes/viewer-access.tsx:16` — update meta title.
- `app/routes/platform/layout.tsx` — update header title.
- `app/components/marketing/MarketingLanding.tsx` and `MarketingNav.tsx` — replace any "School Organizer" / "school-organizer" copy.
- `README.md` heading + intro.
- `package.json:2` `"name": "pickup-roster"` (and let lockfile regenerate; `wrangler.jsonc` `name` stays `school-organizer` for now to preserve the D1 binding — leave a comment noting that).
- `env.d.ts:14` comment — update example to `pickuproster.com`. Add `SUPPORT_EMAIL?: string` to `Env`.
- `.dev.vars.example` — add `SUPPORT_EMAIL=support@pickuproster.com` (commented).

### Acceptance

- `rg -i "school organizer"` returns matches only inside (a) historical migration filenames, (b) `wrangler.jsonc` `name` field, (c) `package-lock.json`. No source/UI string remains.
- New helper `getSupportEmail(context)` returns `support@pickuproster.com` when env unset.

---

## Track B — Sitewide footer + support links

**Depends on:** A (uses `getSupportEmail`).

**Goal:** A consistent footer on marketing, tenant, and error pages with: product name, year, support email mailto, links to `/pricing`, `/faqs`, and a "Status" placeholder. Tenant footer also shows the org's name.

### Files to add

- `app/components/Footer.tsx` — server-safe, accepts `{ siteName, supportEmail, orgName? }`. Tailwind, dark theme matching root.

### Files to change

- `app/root.tsx`:
  - Loader: include `supportEmail` from `getSupportEmail(context)`.
  - Default export: wrap `<Outlet />` in a flex column so `<Footer />` sticks to bottom; pass `orgName={branding?.orgName}`.
  - `ErrorBoundary`: include the same `<Footer />`.
- `app/components/Page.tsx` — if it's the page chrome wrapper, ensure it doesn't fight the new flex layout.

### Acceptance

- All routes (marketing `/`, `/pricing`, `/faqs`, `/signup`, tenant `/admin/*`, `/viewer-access`, `/billing-required`, `/platform/*`, error pages) show the footer. mailto link uses `support@pickuproster.com` by default.

---

## Track C — Stripe Checkout, Customer Portal, comp end-to-end

This is the biggest track. Splits into C1 (server) and C2 (UI). C1 is the dependency; C2 builds on it.

### C1 — Server-side billing primitives

**Files to add**

- `app/domain/billing/checkout.server.ts`
  - `createCheckoutSessionForOrg({ context, orgId, plan, successPath, cancelPath })` — uses `requireStripeConfig`, looks up the org, ensures a `stripeCustomerId` (creates a Customer if missing and stamps it on the Org), then calls `stripe.checkout.sessions.create({ mode: "subscription", customer, line_items: [{ price, quantity: 1 }], success_url, cancel_url, metadata: { orgId, billingPlan } })`. Return the Stripe URL.
  - `createBillingPortalSessionForOrg({ context, orgId, returnPath })` — requires `stripeCustomerId`; calls `stripe.billingPortal.sessions.create({ customer, return_url })`.
  - `priceIdForPlan(stripeConfig, plan)` helper.

- `app/routes/api/billing.checkout.ts` (route in `app/routes.ts`: `route("api/billing/checkout", "routes/api/billing.checkout.ts")`)
  - `action`: requires authed user with `orgId`. Reads `plan` from FormData (`zod-form-data`, must be `CAR_LINE` or `CAMPUS`). Calls `createCheckoutSessionForOrg` and `throw redirect(url)`. Errors → `redirectWithError` back to caller.
  - `loader`: 405.

- `app/routes/api/billing.portal.ts`
  - `action`: same auth gate. Calls `createBillingPortalSessionForOrg` with `returnPath = /admin`. Throws redirect to portal URL.

- `app/routes/billing.success.tsx`
  - Loader requires authed user; reads `?session_id=` from URL; calls `stripe.client.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] })`. If `customer === org.stripeCustomerId` and subscription has data, runs the same `applySubscriptionToOrg`-style update so the UI reflects the new plan immediately (the webhook will also fire; idempotency is preserved by `StripeWebhookEvent` table). Renders a "You're upgraded!" page with confetti + link to `/admin`.

- `app/routes/billing.cancel.tsx`
  - Renders a polite "No charge made" page with a button back to `/pricing` or `/admin`.

**Files to change**

- `app/domain/billing/onboarding.server.ts`: REMOVE the in-line `stripe.client.subscriptions.create` block. Onboarding should ONLY create the Org and set `billingPlan = "FREE"` + `status = "TRIALING"`. If the user picked a paid plan at signup, the post-signup redirect goes to a Checkout URL (handled in C2, signup form).
- `app/routes/api/webhooks.stripe.ts`:
  - Add handlers for `checkout.session.completed` (set `stripeCustomerId` if not yet set, then call `applySubscriptionToOrg` using `session.subscription` retrieved expanded), `invoice.payment_succeeded` (clear `pastDueSinceAt`), `invoice.payment_failed` (no-op or stamp `pastDueSinceAt`).
  - Existing `customer.subscription.*` handlers stay.
- `app/domain/billing/comp.server.ts` (new)
  - `setOrgComp({ context, orgId, compedUntil, billingNote, actorUserId })` — validates dates, updates Org, returns updated row. Also writes a row into a new `OrgAuditLog` table (see schema change below).
  - `clearOrgComp({ context, orgId, actorUserId })` — sets `compedUntil = null`, leaves `billingNote` for record-keeping.

**Schema change**

- New model `OrgAuditLog` (lives next to `Org`):
  ```prisma
  model OrgAuditLog {
    id           String   @id @default(cuid())
    orgId        String
    org          Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
    actorUserId  String?
    action       String   // e.g. "comp.set", "comp.clear", "impersonate.start", "plan.manual_change"
    payload      Json?
    createdAt    DateTime @default(now())

    @@index([orgId])
    @@index([orgId, createdAt])
  }
  ```
- Add migration `migrations/0011_org_audit_log.sql` with matching SQL (CREATE TABLE + indexes).
- Add `auditLogs OrgAuditLog[]` relation on `Org`.

**Acceptance for C1**

- Hitting `POST /api/billing/checkout` with `plan=CAR_LINE` as an authed org admin returns a 302 to `https://checkout.stripe.com/...`.
- Hitting `POST /api/billing/portal` returns a 302 to a portal URL when the org has `stripeCustomerId`; returns 400 when not.
- Webhook test: `customer.subscription.updated` event still updates Org. `checkout.session.completed` event sets `stripeCustomerId` and updates plan/status.
- `setOrgComp` writes an `OrgAuditLog` row with `action: "comp.set"`.

### C2 — Billing UI

**Files to change**

- `app/routes/pricing.tsx`
  - Replace the "Starter" card with two real cards: **Car Line** and **Campus** with the limits from `app/lib/plan-limits.ts`. A "Free trial" card stays.
  - Each paid card has a `<Form method="post" action="/api/billing/checkout">` with `<input type="hidden" name="plan" value="CAR_LINE">` and a `<button type="submit">Start subscription</button>`. Use `useNavigation` to disable the button while submitting.
  - If the visitor isn't authed, the button instead links to `/signup?plan=CAR_LINE` (server reads `plan` and pre-selects it).

- `app/routes/auth/signup.tsx`
  - Convert the multi-step flow's final submit (`handleFinish`) to a `<Form method="post" action="/signup?step=3">` with a route `action`. The `action`:
    - Calls the existing `ensureOrgForUser` server function.
    - If `plan === "FREE"` → redirect to tenant board URL.
    - If paid → create a Checkout Session via `createCheckoutSessionForOrg` and `throw redirect(url)`.
  - Steps 1 & 2 can stay client-side (they're auth + slug check), but consider migrating slug check to a `useFetcher` against `/api/check-org-slug` (already exists) instead of raw `fetch` so submission state is visible.
  - Honor `?plan=` from the URL on first render.

- `app/routes/billing-required.tsx`
  - Add two CTAs: "Update payment method" → `<Form method="post" action="/api/billing/portal">` (when `stripeCustomerId` exists), and "Upgrade plan" → link to `/pricing` (when no customer yet). Show support email.

- `app/components/admin/AdminNav.tsx` (or wherever admin chrome lives — find via `/admin/layout.tsx`)
  - Add "Billing" entry that opens a small page or links to a portal action button. The simplest landing: `/admin/billing` route showing current plan, status, trial days, and a single "Manage billing" button (POST → portal). Plus an "Upgrade" link to `/pricing` for FREE/TRIALING orgs.
  - New file: `app/routes/admin/billing.tsx`. Route entry in `routes.ts`.

- `app/routes/platform/orgs.$orgId.tsx`
  - Add a `Comp` form panel: date input (`compedUntil`), textarea (`billingNote`), Save / Clear buttons. Wire to a route `action` on the same file:
    - `intent=set-comp`: parses date and note; calls `setOrgComp`.
    - `intent=clear-comp`: calls `clearOrgComp`.
    - `intent=manual-plan`: `BillingPlan` select for ENTERPRISE handshake (no Stripe interaction); writes audit log row.
  - Convert `ImpersonateButton` from `authClient.admin.impersonateUser({ userId })` + `window.location.href` to a `<Form method="post" action="/platform/orgs/:orgId">` with `intent=impersonate` and `userId`. The action calls `auth.api.impersonate(...)` server-side (or whatever better-auth's server method is — see `app/domain/auth/better-auth.server.ts`), writes an `OrgAuditLog` row with `action: "impersonate.start"`, sets the impersonation cookie via `commitSession`, and redirects to the tenant board URL.
  - Show a small "Recent audit log" panel using `OrgAuditLog` rows (last 20).

**Acceptance for C2**

- `/pricing` upgrades end at Stripe Checkout for the right price; success returns to `/billing/success?session_id=...` with the Org promoted; cancel returns to `/billing/cancel`.
- Trial org admin can navigate to `/admin/billing` and click "Upgrade" → Checkout, or "Manage billing" → Portal once subscribed.
- Platform staff at `/platform/orgs/:orgId` can comp / uncomp, and audit log shows the change with their user id.
- Impersonation now goes through a route action and writes an audit log entry.

---

## Track D — Sentry server + boundary

**Goal:** Server errors land in Sentry. Route errors caught by `ErrorBoundary` are reported. DSN injection is automatic.

### Files to add

- `app/lib/sentry.server.ts`
  - `initSentry(env)` calls `Sentry.init` from `@sentry/cloudflare` with `dsn: env.SENTRY_DSN`, `release: env.SENTRY_RELEASE`, `environment: env.ENVIRONMENT`, `tracesSampleRate: 0.1`.
  - Re-exports `captureException`, `captureRequestError` (or `sentryHandleError`).

### Files to change

- `workers/app.ts` — wrap the worker fetch handler with `Sentry.withSentry(env => initSentryConfig)` per the `@sentry/cloudflare` docs; ensure `ctx.waitUntil(Sentry.flush())`. (Look up the exact API surface for v9.)
- `app/entry.server.tsx` — add `handleError` export that calls `Sentry.captureException(error, { mechanism: { handled: false } })`. Also import the server Sentry once at module top so transactions track SSR.
- `app/root.tsx` `loader` — pass `sentryDsn: env.SENTRY_DSN` (only the public DSN, which is fine to expose) into the loader data, then in the `App` default export render `<script dangerouslySetInnerHTML={{__html: \`window.__sentryDsn=${JSON.stringify(dsn)}\`}} />` BEFORE `<Scripts />` so the client init in `entry.client.tsx` picks it up. Same in `ErrorBoundary`.

### Acceptance

- Throwing a synthetic error in any loader/action lands in Sentry (verified by inspecting requests in dev — the body of the captured event should include the route id).
- `window.__sentryDsn` is set on the page when `SENTRY_DSN` is configured; client init populates correctly.

---

## Track E — Staff (Platform) UX gaps

**Depends on:** C1 (audit log model) for impersonation logging; otherwise independent.

**Goal:** Make `/platform` something staff can actually run an account ops shift in.

### Files to change / add

- `app/routes/platform/index.tsx`
  - Add pagination (`?cursor=` or `?page=`), default `take: 50`. URL-driven.
  - Add status filter pills (ACTIVE, TRIALING, PAST_DUE, SUSPENDED, CANCELED) and plan filter via `useSearchParams`.
  - Add a "Created" sort toggle.
  - Show a "comped" badge when `compedUntil > now`.

- `app/routes/platform/sessions.tsx`
  - Add filter inputs (email contains, since date) via `<Form method="get">`.
  - Show `impersonatedBy` column.
  - Add a "Revoke session" action button per row → POST to a new route `app/routes/platform/sessions.revoke.ts` (action only) that calls `auth.api.revokeSession`.

- `app/routes/platform/webhooks.tsx`
  - Add filter by `type`, since date.
  - Link each row to a detail drawer/route showing the raw payload (you'll need to extend `StripeWebhookEvent` with a `payload Json?` column — new migration `0012_stripe_webhook_event_payload.sql` — and store the `event.data.object` snapshot in the webhook handler).

- `app/routes/platform/audit.tsx` (new)
  - Cross-org audit log viewer over `OrgAuditLog`. Filters: org, actor, action.
  - Route entry in `routes.ts`.

### Acceptance

- `/platform` paginates with stable URLs and shows comp badges.
- Sessions can be filtered and revoked.
- Webhook list shows raw payloads in a detail view.
- New `/platform/audit` view exists.

---

## Track F — Tenant (Admin) UX gaps

**Goal:** Bring the staff-side admin closer to "polished and obvious."

### Files to change

- `app/routes/admin/dashboard.tsx`
  - Convert any `useState`-driven calls that mutate server state to `useFetcher` against a route `action` if not already.
  - Add a "Plan usage" panel using `buildUsageSnapshot` (already exists). Show progress bars for students/families/classrooms with warning at 80% and link to `/admin/billing`.

- `app/routes/admin/users.tsx`
  - Add an `intent` column to the action so all submissions go through one `<Form>`. Today many small pieces likely use raw fetch — convert to `useFetcher`.
  - Lock reset action gets a "reason" textarea that goes into `OrgAuditLog`.

- `app/routes/admin/branding.tsx`
  - Add "Custom domain" field (writable). Action validates host format and writes to `Org.customDomain` (uniqueness is already enforced by `@unique` in schema; surface the friendly error).
  - Add a logo preview before upload using `URL.createObjectURL` (browser API).

- `app/routes/admin/drills.$templateId.run.tsx`
  - Add multi-user concurrency: surface `updatedAt` from the run state in the loader, send it back in the action, and reject stale writes (return `409` with toast).

- `app/routes/admin/layout.tsx`
  - Add a "Billing" nav entry pointing to `/admin/billing` (created in C2).
  - Show a small banner when `org.compedUntil > now` ("Your account is comped through {date}.").

### Acceptance

- Admin dashboard shows live plan usage with warnings.
- Branding page can edit custom domain.
- Fire drill rejects concurrent stale writes with a clear message.
- Comp banner appears when applicable.

---

## Track G — Operational glue

**Goal:** Things that are easy to forget but matter for a real product launch.

### Files to add / change

- `.dev.vars.example` — add the new vars: `STRIPE_SECRET_KEY=`, `STRIPE_WEBHOOK_SECRET=`, `STRIPE_CAR_LINE_PRICE_ID=`, `STRIPE_CAMPUS_PRICE_ID=`, `SUPPORT_EMAIL=support@pickuproster.com`, `SENTRY_DSN=`.
- `wrangler.jsonc` `vars` — add `SUPPORT_EMAIL: "support@pickuproster.com"`. Leave `SENTRY_DSN` empty (set as secret per env).
- `README.md` — update name, add a "Stripe setup" subsection that points to `docs/stripe-products.md` and lists the secrets to set with `wrangler secret put`.
- `.github/workflows/ci.yml` (new) — run `npm ci`, `npm run typecheck`, `npm run test` on push/PR.
- `app/lib/site.test.ts` (new) — unit test for `getSupportEmail` env handling.

### Acceptance

- `npm run typecheck && npm run test` green.
- CI workflow file exists and is syntactically valid.

---

## Execution order for subagents

1. **A** (rebrand) and **D** (Sentry) and **G** (ops glue, except CI) can run in parallel up front. They touch mostly disjoint files. *Note:* G's `.dev.vars.example` edits should be added to A's diff if both are running concurrently — assign one of them to own that file.
2. **C1** (Stripe server) starts in parallel with A/D/G.
3. **B** (footer) and **C2** (billing UI) start once **A** is merged (B uses `getSupportEmail`; C2 uses `Form` patterns established by A's housekeeping).
4. **E** (platform) starts once **C1** is merged (needs the audit log model).
5. **F** (tenant) starts once **C2** is merged (needs `/admin/billing`).

Dependency graph (for the task system):

- B blockedBy A
- C1 blockedBy (none)
- C2 blockedBy A, C1
- D blockedBy (none)
- E blockedBy C1
- F blockedBy C2

---

## Definition of done for the whole push

- A trial org admin can: sign up → land on tenant board → click Upgrade → pay via Stripe → return with plan promoted. They can later open the Stripe billing portal from `/admin/billing`.
- A platform staffer can: open any org, mark it comped with a date and note, see the change in the audit log, impersonate a user with the action recorded, and review recent audit history.
- Any uncaught server or client error reaches Sentry with the route id attached.
- Every page renders the same footer with `support@pickuproster.com`.
- `npm run typecheck` and `npm run test` pass; CI runs them on PRs.
- No source-code reference to "School Organizer" remains outside historical migration files and the legacy `wrangler.jsonc` `name` field.
