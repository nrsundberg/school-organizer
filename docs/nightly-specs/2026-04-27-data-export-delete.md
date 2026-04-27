# Research spec — #5 data-export-delete

**Author:** polish agent, 2026-04-27.
**Workstream:** Priority 2, item #5 in `docs/nightly-queue.md`.
**Status:** research only — no code changed in this run.
**Depends on:** nothing in flight; `planAllowsReports` already exists in `app/lib/plan-limits.ts`, `recordOrgAudit` already exists in `app/domain/billing/comp.server.ts`.
**Companion to:** none — first spec for this workstream.

---

## Problem

Two GDPR-/FERPA-style admin actions Pickup Roster has promised in pricing copy but doesn't ship today:

1. **Export** every record an org owns as a downloadable archive, so a school admin can leave the product (or just keep an offline copy) without a support-ticket round-trip.
2. **Delete** all student/family data when a school decides to stop using the product, while keeping the `Org` row + Stripe customer/subscription so billing continuity isn't broken (Stripe receipts, audit trail, the ability to renew without a fresh signup).

The queue's inline scope already pins both routes, the gating, and the audit-log requirement; this spec fills in the implementation reality (what tables to dump, how to stream a zip from a Cloudflare Worker without OOM-ing, what fields the delete flow has to avoid touching, where sidebar/i18n keys live) so a build agent can pick it up in one nightly run without a second research pass.

These features are non-negotiable for two pilot conversations Noah has flagged ("we need a written data-portability commitment"), and they're cheap to ship — both are read-only or single-transaction operations against tables we already query. Holding up a sale on a 200-line route is bad value.

## Current state

### What already exists in repo

- **`planAllowsReports(billingPlan)`** in `app/lib/plan-limits.ts` lines 67–75 — returns true for `CAMPUS | DISTRICT | ENTERPRISE`. This is the same gate `app/routes/admin/history.tsx` uses for CSV download. Reuse it verbatim — the queue's inline scope explicitly says "Campus+ plan gated via `planAllowsReports` pattern".
- **`recordOrgAudit({ context, orgId, actorUserId, action, payload })`** in `app/domain/billing/comp.server.ts` lines 3–27 — already used in 6 call sites (`platform/orgs.new.tsx`, `platform/orgs.$orgId.tsx` ×2, `admin-users/invite-user.server.ts`, `billing/comp.server.ts` ×2). Action strings observed in master are dot-namespaced: `"plan.manual_change"`, `"trial.extend"`, `"comp.set"`, `"user.invite"`. New actions for this workstream:
  - `"data.export"` — payload `{ filename, byteSize, rowCounts: { students, teachers, spaces, callEvents, users, households, dismissalExceptions, programs } }`.
  - `"data.delete_all"` — payload `{ confirmedSlug, rowCountsBefore, rowCountsAfter }`.
- **CSV-download Response pattern** in `app/routes/admin/history.tsx` lines 245–280 — the loader sniffs `?format=csv`, builds the body, returns `new Response(body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"...\"", "Cache-Control": "no-store" } })`. The export route follows the exact same shape, just with `application/zip` and a streamed body.
- **Admin-route auth** in `app/routes/admin/layout.tsx` lines 27–28 — `await protectToAdminAndGetPermissions(context)` is the universal admin gate. Reuse it in both new loaders/actions; nothing else needed.
- **Sidebar pattern** in `app/components/admin/AdminSidebar.tsx` — `baseNavItems` array of `{ to, labelKey, icon }`. Both new routes need entries:
  - `/admin/data-export` → `sidebar.dataExport`, icon `Download` from `lucide-react` (already an import-able name).
  - `/admin/data-delete` → does **not** belong in the everyday sidebar. Surface it from inside `data-export.tsx` as a "Danger zone" link at the bottom (precedent: GitHub repo settings, Stripe API keys page). Putting "Delete all data" one click from "Dashboard" is asking for an accident.
- **i18n** — `app/i18n.server.ts` + `public/locales/{en,es}/admin.json`. Both routes need new keys; the existing `branding.errors.advancedRequired` / `history.upgrade.csvForbidden` patterns show how plan-gated copy lives under the route's namespace.
- **Org cascade graph** — already verified in `prisma/schema.prisma`:

  ```
  Org → Teacher[]                   (onDelete: Cascade)
      → Student[]                   (onDelete: Cascade)
      → Space[]                     (onDelete: Cascade)
      → CallEvent[]                 (onDelete: Cascade)
      → Household[]                 (onDelete: Cascade)
      → DismissalException[]        (onDelete: Cascade)
      → AfterSchoolProgram[]        (onDelete: Cascade)
      → ProgramCancellation[]       (onDelete: Cascade)
      → AppSettings[]               (onDelete: Cascade)
      → ViewerAccessAttempt[]       (onDelete: Cascade)
      → ViewerAccessSession[]       (onDelete: Cascade)
      → ViewerMagicLink[]           (onDelete: Cascade)
      → DrillTemplate[]             (onDelete: Cascade)
      → DrillRun[]                  (onDelete: Cascade)
      → OrgAuditLog[]               (onDelete: Cascade)
      → User[]                      (onDelete: Cascade — but see Open Q #2)
  ```

  Crucially, **the `Org` row itself is what triggers the cascade** — but the queue says we **must not** delete the `Org` row (Stripe + audit continuity). So the delete flow has to walk the relations explicitly rather than `prisma.org.delete()`.

### What does not exist

- No `app/routes/admin/data-export.tsx`.
- No `app/routes/admin/data-delete.tsx`.
- No zip library on `package.json` (`fflate`, `jszip`, `archiver`, `adm-zip` — none of them are installed). Choosing one is the single biggest implementation question; see Proposal § "Zip library".
- No e2e flow spec for either route. Smoke sweep covers `/admin/branding` + `/admin/history` but has no entries under `/admin/data-*`.
- No `Download` import in `AdminSidebar.tsx` (needs to be added alongside `Palette` etc.).

### Implementation reality the build agent will hit

- **Cloudflare Workers memory ceiling.** A Worker request has 128 MB of heap. A 900-student CAMPUS org is the largest legal payload, and even with full call-event history a JSON dump comes in well under 5 MB uncompressed (call-event rows are the dominant volume — historic estimate: 900 students × ~180 dismissals/year × ~80 bytes/row ≈ 13 MB at three years). Streaming the zip body avoids needing the full archive in memory at once; `fflate` (recommended below) supports a chunked-emit `Zip` constructor that yields Uint8Arrays as each entry finishes, perfect for `new Response(stream, …)`.
- **D1 row-count limits.** D1 returns up to 1 MB per query. For the largest org (3-year CAMPUS call events), that's ~12 K rows / ~1 MB at JSON encoding overhead — close enough to the limit that the export should paginate `findMany` with `take: 5000` + cursor if a row count returns >5000. The history route already handles this concern by ordering on `createdAt desc` + cap; reuse the cursor pattern (see `/admin/households` PR #16 for cursor-based pagination precedent).
- **Stripe customer must survive.** The delete flow has to leave `Org.stripeCustomerId`, `Org.stripeSubscriptionId`, `Org.subscriptionStatus`, `Org.billingPlan`, `Org.trialEndsAt`, `Org.compedUntil`, `Org.isComped`, `Org.pastDueSinceAt`, and `Org.districtId` untouched. The queue's "Keeps the org row + stripe for billing continuity" line is precise — touching any of these would orphan the Stripe customer.
- **`User` rows are scoped by org but log into a session that survives delete.** Today, `prisma.user.deleteMany({ where: { orgId } })` would invalidate every active admin session for that org — including the one that's executing the delete. The flow needs to either (a) defer User deletion to a follow-up admin click after the admin signs back in (clean but two-step), or (b) skip the executing user and let them log out manually (simpler). Open Q #2 picks one — recommendation: skip the executing admin's row, delete the rest, force logout client-side via `Set-Cookie`-clearing redirect to `/login?dataDeleted=1`.
- **`OrgAuditLog` rows are sensitive in a different direction.** They're the legal-defensible record that *something happened*; deleting them on user request would erase the very audit log entry the export+delete pair is supposed to *create*. Skip them — the queue scope deliberately says "students/teachers/spaces/callEvents/families", not "everything". Audit log is preserved.

## Proposal

Two routes, both ≤ 220 LOC, both written against the same `recordOrgAudit` + `planAllowsReports` infrastructure that ships today.

### 1. `/admin/data-export` — streamed zip of org data

**Route:** `app/routes/admin/data-export.tsx` (new file, ~140 LOC).

- **Loader:**
  - `protectToAdminAndGetPermissions(context)`.
  - `org = getOrgFromContext(context)`; `prisma = getTenantPrisma(context)`.
  - If `!planAllowsReports(org.billingPlan)`: return `{ upgradeRequired: true, billingPlan: org.billingPlan, metaTitle }`. UI renders an upsell card identical in structure to `history.tsx` lines 248–258. Also support `?format=zip` 403 path so a crafted GET doesn't slip through.
  - Otherwise: return `{ upgradeRequired: false, lastExportAt: <Date | null from latest OrgAuditLog with action="data.export">, rowCounts: <preview from a parallel `Promise.all` of `count` calls> }`. The preview lets the UI show "You're about to export 412 students, 38 teachers, 4,217 call events, 92 households" before the user commits.

- **Action (`POST /admin/data-export?format=zip`):**
  - Same protect + plan gate as loader.
  - For each table in the cascade list above (minus `OrgAuditLog`, plus `User` minimal columns — see Open Q #3), `findMany({ where: { orgId } })` paginated with `take: 5000` cursor.
  - Strip cookies, password hashes, Stripe customer IDs, viewer-access raw PINs from each row. The export is for the **school**, not for downstream attackers if the file leaks. A whitelist per table (see Open Q #4) is safer than a blacklist.
  - Use `fflate`'s streaming `Zip` to emit each table as a `*.json` entry: `students.json`, `teachers.json`, `spaces.json`, `call-events.json`, `users.json`, `households.json`, `dismissal-exceptions.json`, `programs.json`, `program-cancellations.json`, `app-settings.json`, plus a top-level `manifest.json` with `{ orgId, orgSlug, exportedAt, exportedByUserId, planAtExport, schemaVersion: "1", rowCounts }`.
  - Wrap the `Zip` in a `ReadableStream` (Cloudflare Workers `ReadableStream` is the standard one) and return `new Response(stream, { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=\"<slug>-data-export-<ymd>.zip\"", "Cache-Control": "no-store" } })`.
  - **After** the stream resolves (use `stream.tee()` or a `runOnWrite` counter — see fflate docs), call `recordOrgAudit({ context, orgId: org.id, actorUserId: me?.id ?? null, action: "data.export", payload: { filename, byteSize, rowCounts } })`. Audit-log write **must** happen on success only; a streamed Response that errors mid-flight should not leave a misleading "exported successfully" log entry.

- **Component:**
  - One H1, the row-count preview, a single `<Form method="post" action="?format=zip">` with a `<Button>` "Download data export". Pending state via `useNavigation`.
  - "Last exported: <relative time>" line if the audit log shows a previous export.
  - "Danger zone" footer card linking to `/admin/data-delete` with the lucide `AlertTriangle` icon. Match the visual language `history.tsx` uses for its summary cards.

### 2. `/admin/data-delete` — destructive double-confirm flow

**Route:** `app/routes/admin/data-delete.tsx` (new file, ~180 LOC).

- **Loader:**
  - `protectToAdminAndGetPermissions(context)`.
  - **No plan gate.** Per the queue scope, delete is available on every plan — gating it would let a downgraded org get stuck with their data they can't remove.
  - Returns `{ orgSlug, rowCounts, lastExportAt, hasRecentExport: lastExportAt != null && lastExportAt > now-7d }`.

- **Component:**
  - Big red "Danger" banner.
  - Three-paragraph plain-English description of what gets deleted vs. preserved.
  - "We strongly recommend exporting your data first" CTA → `/admin/data-export` (suppressed if `hasRecentExport`).
  - **Confirmation gate**: an `<input>` that requires the user to type the org slug exactly. Submit button disabled until `value === orgSlug` (client-side, but the action re-checks server-side).
  - A second checkbox "I understand this is irreversible" that must be checked.

- **Action (`POST /admin/data-delete`):**
  - Same protect.
  - Validate body: `confirmSlug === org.slug` AND `acknowledged === "on"`. Otherwise return 400 with form-level error.
  - **Pre-snapshot:** `rowCountsBefore = await Promise.all([... .count()])` for every table on the list. This goes into the audit log — the only durable record of what was deleted.
  - **Wrap deletes in a single `prisma.$transaction`** (D1 supports it via the @prisma/adapter-d1 wrapper). Order matters because of FK chains:
    1. `programCancellation.deleteMany({ where: { orgId } })` (depends on AfterSchoolProgram).
    2. `afterSchoolProgram.deleteMany({ where: { orgId } })`.
    3. `dismissalException.deleteMany({ where: { orgId } })`.
    4. `callEvent.deleteMany({ where: { orgId } })` (depends on Student/Space).
    5. `viewerAccessSession.deleteMany({ where: { orgId } })`.
    6. `viewerAccessAttempt.deleteMany({ where: { orgId } })`.
    7. `viewerMagicLink.deleteMany({ where: { orgId } })`.
    8. `appSettings.deleteMany({ where: { orgId } })`.
    9. `student.deleteMany({ where: { orgId } })`.
    10. `teacher.deleteMany({ where: { orgId } })`.
    11. `space.deleteMany({ where: { orgId } })`.
    12. `household.deleteMany({ where: { orgId } })`.
    13. `drillRun.deleteMany({ where: { orgId } })`.
    14. `drillTemplate.deleteMany({ where: { orgId } })`.
    15. `user.deleteMany({ where: { orgId, NOT: { id: me.id } } })` — see Open Q #2.
  - **Outside the transaction**: `recordOrgAudit({ ..., action: "data.delete_all", payload: { confirmedSlug, rowCountsBefore, rowCountsAfter: { all-zero } } })`.
  - **Outside the transaction**: clear the Worker KV / Durable Object cache that the realtime board reads from, otherwise viewers see ghost rows for ~30s. The board DO is keyed by `<orgId>:board` — invalidate that key. Look at how the existing `clearOrgComp` route handles cache invalidation; if there isn't one, this is a `dev-only` open question — see Open Q #5.
  - Return a redirect to `/admin?dataDeleted=1`. The dashboard already has banner machinery for billing-status messages (`PastDuePaymentBanner`); add a one-line banner that fades after 10s.

### 3. Sidebar + i18n

- `AdminSidebar.tsx`:
  ```ts
  // Add to the import list at the top
  import { Download, AlertTriangle } from "lucide-react";

  // Add to baseNavItems, between History and Branding
  { to: "/admin/data-export", labelKey: "sidebar.dataExport", icon: Download },
  ```
  No entry for `data-delete` — surfaced from inside the export page only.
- `public/locales/en/admin.json`: add a `dataExport.*` and `dataDelete.*` block. Skeleton:
  ```json
  {
    "sidebar": {
      "...": "...",
      "dataExport": "Data export"
    },
    "dataExport": {
      "metaTitle": "Admin – Data export",
      "heading": "Export your school's data",
      "description": "Download a zip archive containing every roster, call event, household, and configuration record this org has stored.",
      "preview": {
        "title": "What's in your export",
        "studentsCount": "{{count}} students",
        "callEventsCount": "{{count}} call events",
        "...": "..."
      },
      "downloadButton": "Download data export",
      "lastExportedAt": "Last exported {{time}}",
      "upgrade": {
        "title": "Data export is a Campus feature",
        "body": "Upgrade to Campus to export every record this org has stored.",
        "cta": "Upgrade to Campus",
        "zipForbidden": "Data export requires the Campus plan."
      },
      "dangerZone": {
        "title": "Danger zone",
        "body": "Permanently delete all roster, dismissal, and household data.",
        "cta": "Delete all data"
      }
    },
    "dataDelete": {
      "metaTitle": "Admin – Delete all data",
      "heading": "Permanently delete all org data",
      "warningParagraph1": "This will delete every student, teacher, space, call event, household, drill, and non-admin user belonging to <strong>{{orgName}}</strong>.",
      "warningParagraph2": "Your billing record, audit history, and admin login are preserved so you can re-onboard later.",
      "warningParagraph3": "This action cannot be undone. We strongly recommend you <a>export your data</a> before continuing.",
      "confirmInputLabel": "Type your org slug ({{slug}}) to confirm",
      "acknowledgeLabel": "I understand this is irreversible.",
      "deleteButton": "Permanently delete all data",
      "errors": {
        "slugMismatch": "Slug doesn't match. Type {{slug}} exactly.",
        "ackRequired": "Please acknowledge before deleting."
      }
    }
  }
  ```
  `es/admin.json` gets the same keys with translations; if the build agent doesn't have a translator handy, copy English values verbatim with a `// TODO: translate` and let the polish agent's next i18n sweep pick it up. (Same pattern the support-contact spec used.)

### 4. Zip library

**Recommendation: `fflate`.**

- 100% JS, no native binaries — works in the Workers runtime.
- 8 KB minified, tree-shakeable — package size pressure isn't a concern but it's polite.
- Supports a `Zip` constructor that takes a `flush` callback per chunk, which maps cleanly to a `ReadableStream` controller — exactly what we need for streaming the response without holding the whole archive in memory.
- MIT licensed.

Alternatives weighed and rejected:

- **`jszip`** — mature but ~100 KB and its streaming API was not ported cleanly to Workers; documented OOM behavior on large blobs.
- **`archiver`** — Node-only (uses the `node:fs` write stream pattern); won't run in Workers without a polyfill we'd have to vendor.
- **Build the zip by hand** — feasible (zip's central directory + local headers are documented), but unjustified extra surface area for a feature whose value is "school can leave."

Install: `npm install fflate`. No types package — `fflate` ships its own `.d.ts`.

### 5. Tests

- **Unit (`app/routes/admin/data-export.server.test.ts`):**
  - `buildManifest({...})` returns the right shape.
  - `whitelistRow(table, row)` strips `passwordHash`, `stripeCustomerId`, `pinHash`, `accessToken` for the relevant tables.
- **Unit (`app/routes/admin/data-delete.server.test.ts`):**
  - Action rejects when `confirmSlug !== org.slug`.
  - Action rejects when `acknowledged !== "on"`.
  - Delete order matches the FK chain (snapshot test against the array literal).
- **Playwright (`e2e/flows/data-export-delete.spec.ts`):** depends on the seeded-tenant fixture's `tenantBillingPlan` option (landed 2026-04-26 spec, build pending). Three cases:
  1. **CAR_LINE plan, GET `/admin/data-export`** — page renders the upsell, no download form, no `data-export` audit log entry.
  2. **CAMPUS plan, POST `/admin/data-export?format=zip`** — Response status 200, `Content-Type: application/zip`, `Content-Disposition: attachment;`, body length > 0, audit log gains one `data.export` entry.
  3. **CAMPUS plan, POST `/admin/data-delete`** with correct slug + ack — response is 302 to `/admin?dataDeleted=1`, follow-up `prisma.student.count({ where: { orgId } })` returns 0, `prisma.org.findUnique({ where: { id: orgId } })` still returns the row with `billingPlan: "CAMPUS"` and `stripeCustomerId` unchanged, audit log gains one `data.delete_all` entry.
- **Smoke sweep:** add `/admin/data-export` to `e2e/smoke-routes.ts` for the universal "200 + heading present" check at CAMPUS plan. Don't add `/admin/data-delete` — it should be reachable only via the deliberate click-through, and a smoke test that GETs it would pollute the smoke output if a regression renders a 500.

## File list

**New (touched only by this workstream):**

- `app/routes/admin/data-export.tsx`
- `app/routes/admin/data-delete.tsx`
- `app/routes/admin/data-export.server.test.ts`
- `app/routes/admin/data-delete.server.test.ts`
- `e2e/flows/data-export-delete.spec.ts`
- `docs/data-export-delete.md` — short admin-facing FAQ ("what's in the export?", "what happens to my Stripe subscription if I delete?", "can I undo?"). Helpful for support emails until/unless this gets a public help-center page.

**Modified:**

- `app/routes.ts` — register both routes under the `admin/*` prefix.
- `app/components/admin/AdminSidebar.tsx` — `Download` import + `dataExport` nav item.
- `e2e/smoke-routes.ts` — add `/admin/data-export` to the admin-authed sweep.
- `package.json` + `package-lock.json` — add `fflate`.
- `public/locales/en/admin.json` — `dataExport.*` + `dataDelete.*` blocks per § 3.
- `public/locales/es/admin.json` — same keys, translated or stubbed.

**Not touched:**

- `prisma/schema.prisma` — no schema change. The cascade is already correct; the delete flow walks the relations explicitly to avoid taking out the `Org` row.
- `app/db/generated/*` — generated client doesn't change.
- `app/lib/plan-limits.ts` — reuse `planAllowsReports` as-is.
- `app/domain/billing/comp.server.ts` — reuse `recordOrgAudit` as-is.

## Testing approach

1. Local dev (`npm run dev`):
   - Sign in to a CAR_LINE-plan dev org. Visit `/admin/data-export` — should see the upsell.
   - Manually flip `Org.billingPlan` to `CAMPUS` in `dev.db`. Reload — should see the row-count preview + a download button.
   - Click download. Open the resulting zip and confirm `manifest.json` + the per-table JSONs are present.
   - Click "Danger zone → Delete all data". Type wrong slug → button stays disabled. Type correct slug, check the box, submit. Confirm `/admin?dataDeleted=1` lands and the dashboard shows the banner.
   - Re-verify in `dev.db`: `Org` row intact with `stripeCustomerId` unchanged, `Student`/`Teacher`/`CallEvent` count = 0, `OrgAuditLog` has both new entries.

2. Unit tests as above (`npm test`).

3. Playwright (`npx playwright test e2e/flows/data-export-delete.spec.ts`) — gated on the build agent picking up the 0d.3 spec landed 2026-04-26 (which adds the fixture's `tenantBillingPlan` option needed for the CAMPUS test cases). If 0d.3 isn't merged when this workstream is picked up, mark the multi-plan playwright cases `.fixme` with a comment pointing at 0d.3, ship the rest.

4. Staging smoke (per AGENTS.md gate): the `/admin/data-export` smoke entry catches a 500 regression on the loader; the destructive POST is **not** part of staging smoke (a smoke run that wipes the staging tenant would be self-defeating).

## Open questions

1. **Should the zip include `OrgAuditLog`?**
   The queue scope explicitly enumerates "students/teachers/spaces/callEvents/users" and stops there. Audit log entries are a *Pickup Roster* artifact, not the school's data. **Recommendation: include `audit-log.json` in the export but not in the delete.** A school that's leaving has a legitimate "what did we do" record interest; a school that's deleting has the same interest amplified by needing the deletion event to survive. Build agent can flip this if a privacy-counsel review says otherwise — it's a one-line whitelist-table change.

2. **`User` deletion: skip the executing admin or two-step flow?**
   - **Option A (recommended):** delete every `User` belonging to the org *except* the one executing the delete; on success, set a `dataDeleted=1` query param that the dashboard reads to render a "We've deleted everything except you. Sign out when ready or click here to also delete your admin account." banner with a final cleanup button. Two clicks, no race, no self-cancellation.
   - **Option B:** delete every `User` including the executing one, force `Set-Cookie` clear, redirect to `/login?dataDeleted=1`. Cleaner UX, but the executing admin *is* an `OrgAuditLog.actorUserId`, so the audit row gets `actorUserId: null` after deletion (FK is `actorUserId String?`, no FK ref) — the audit trail still works, just loses attribution of the click.
   - Build agent picks one based on which UX feels right after building the rest. Both are within the queue scope.

3. **Whitelist columns per table.** Listed below as a starting point — build agent should sanity-check against the live schema:
   - `Student`: `id, firstName, lastName, homeRoomId, spaceNumber, grade, guardianEmail, status, createdAt`. Drop nothing today; all columns are "the school's data."
   - `Teacher`: `id, firstName, lastName, email, homeRoomName, createdAt`. Drop `passwordHash` if present (today there isn't one — teachers don't sign in directly — but the export should still whitelist explicitly).
   - `Space`: `id, number, status, createdAt`.
   - `CallEvent`: `id, spaceNumber, studentId, studentName, homeRoomSnapshot, createdAt, actorUserId, onBehalfOfUserId`. Same shape `history.tsx` already exports as CSV; reuse `CallEventRow` if importable.
   - `User`: `id, email, role, createdAt, locale, status`. **Drop `passwordHash`, any session token, any 2FA secret.** This is the single highest-stakes whitelist; if `passwordHash` leaks in an export the org admin took offline the school could face a credential-stuffing fallout. Build agent should add a unit assertion that `passwordHash` is NOT a key in any object of `users.json`.
   - `Household`: `id, primaryGuardianName, address, phone, createdAt` plus child links via `studentIds`.
   - `DismissalException`: all columns.
   - `AfterSchoolProgram`, `ProgramCancellation`: all columns.
   - `AppSettings`: drop `viewerPinHash`, keep the visual config columns.
   - **Skip entirely**: `ViewerAccessSession`, `ViewerAccessAttempt`, `ViewerMagicLink`, `Session`, `Account`, `PasswordResetToken`, `UserInviteToken`, `Verification`, `StripeWebhookEvent`, `SentEmail`, `StatusCheck`, `StatusIncident`. None of these are "the school's data" — they're auth/transport state.

4. **Should the export be rate-limited?** A CAMPUS org can in principle hammer `POST /admin/data-export?format=zip` and emit a few MB of zip per second. The repo has rate-limiting infra (`docs/rate-limiting.md`) — recommendation is one export per org per 5 min, key `data-export:<orgId>`. Returns 429 with retry-after.

5. **Cache invalidation after delete.** The realtime board Durable Object holds the last-known board state in memory. The simplest correct path is to broadcast a board-reset message after the delete txn — find out from `app/lib/durable-objects/board.ts` (or wherever the BINGO_BOARD DO lives) whether there's already a "wipe org" entry point. If not, this is a small adjacent ticket the build agent can either inline or punt to `docs/nightly-queue.md` as item #5.1. **Recommendation: punt.** A leftover stale board for 30s is much less bad than a half-finished feature.

6. **What happens to the org's R2 logo?** `Org.logoObjectKey` may point at a file in `pickup-roster-org-branding`. The delete flow doesn't touch R2 today. Recommendation: best-effort `r2.delete(org.logoObjectKey)` after the txn, log on failure (don't roll back — R2 deletion is non-critical relative to the DB hard-delete). Same one-line addition for staging vs prod buckets via `env.ENVIRONMENT`.
