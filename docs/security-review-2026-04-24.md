# Security & Compliance Review — Pickup Roster

**Date:** 2026-04-24 (updated after P0 subagent passes)
**Reviewer:** Claude (sysadmin / appsec lens)
**Scope:** `school-organizer` repo — React Router 7 on Cloudflare Workers + D1 + Prisma + R2, better-auth, Stripe, Resend, Sentry.

This file only lists what's still open. Completed items are summarized at the bottom. For the original full review (incl. strengths + how the tenant-extension works + what the PII surface actually is), see the commit history of this file.

---

## P0 branch status

The P0-1, P0-2, P0-3, and P0-5 branches have been merged. Their completed work is summarized at the bottom of this review. The remaining P0 is MFA / 2FA for privileged roles.

---

## Still-open — security findings

### P0 (fix this sprint)

**P0-4. No MFA / 2FA on any role.** Deliberately deferred from the subagent sweep. `better-auth` ships `@better-auth/two-factor`; enable TOTP and gate ADMIN + PLATFORM_ADMIN accounts behind it. Backup codes required. This is the single largest remaining account-takeover risk: one compromised admin exports every student record for that org.

### P1 (this quarter)

**P1-1. Sentry has no PII scrubber.** `tracesSampleRate: 0.1` with no `beforeSend` in `app/lib/sentry.server.ts` or `workers/app.ts`. A URL like `/edit/edit.student.123?firstName=Jane` ends up in Sentry, a third-party processor not on your DPA. Add a `beforeSend` hook that strips `firstName`, `lastName`, `email`, `phone`, student IDs, and carline numbers from `request.data`, `request.query_string`, breadcrumbs, and exception messages. Set `sendDefaultPii: false` explicitly.

**P1-2. `Object.assign(process.env, env)` in `workers/app.ts`.** Copies every secret into a mutable global per request. Blast radius is one isolate, but any lib that logs `process.env` (or an SSR error that serializes it) leaks `BETTER_AUTH_SECRET` + `STRIPE_SECRET_KEY`. Pass `env` through context only; remove the assign.

**P1-3. No data-retention plumbing.** `CallEvent`, `OrgAuditLog`, `ViewerAccessAttempt`, `Verification`, `StatusCheck` grow forever. FERPA + most state DPAs require a documented retention schedule and a deletion mechanism on contract end. Build a daily cron that prunes by configurable per-org TTL; document the schedule in `docs/data-retention.md`.

**P1-4. No "delete this student" / right-to-delete flow.** Removing a student leaves `CallEvent.studentName` snapshots forever. Either anonymize on delete (blank the `studentName` string, keep the timestamp) or hard-cascade.

**P1-5. Default `orgId = "org_tome"` on tenant tables.** Schema defaults `Teacher`, `Student`, `Space`, `CallEvent`, `AppSettings`, `ViewerAccess*` to a hardcoded org. The Prisma extension covers app code, but any raw insert (seed script, ad-hoc migration, a job that uses the un-extended client) silently lands data in someone else's org. Drop the defaults; force callers to be explicit.

**P1-6. Verify R2 logo upload MIME-sniffs.** Read `validateLogoUpload` in `app/domain/org/branding.server.ts`. It should reject SVG (or strip `<script>`/event handlers), check magic bytes not just `Content-Type`, and re-encode through `sharp` or the Cloudflare Images API to drop EXIF + any embedded payloads. An SVG-with-script served from your domain bypasses any CSP.

**P1-7. `safeRedirect` allows backslash tricks.** `app/routes/viewer-access.tsx` rejects `//evil.com` but not `/\evil.com` — browsers parse `\` inconsistently. Replace the string prefix check with `new URL(next, url.origin)` and assert `.origin === url.origin`.

**P1-8. No SBOM / dependency CI.** `.github/workflows/` has no scheduled `npm audit` or Dependabot. Add Dependabot weekly + a CI step that fails on high-severity advisories. (Now that P0-5 cleaned the tree, this keeps it clean.)

**P1-9. Stripe webhook signature failures are silent.** `webhooks.stripe.ts` returns a generic 400 on `constructEventAsync` failure with no `captureException` and no rate alarm. Log + Sentry on mismatch; alert if rate > N/min.

**P1-10. Confirm impersonation always audits.** `Session.impersonatedBy` exists; verify every code path that sets it also writes an `OrgAuditLog` row with impersonator user id + target. Worth a unit test.

**P1-11. Trash file in repo root.** `.trash-untracked-manual-1438-schools.md` (21 KB) — confirm contains no real student names. Auditors grep the repo.

### P2 (audit-readiness)

**P2-1.** Document encryption at rest. D1 and R2 are Cloudflare-encrypted — say so in `docs/security.md`.
**P2-2.** Backups + restore drill. D1 Time Travel gives 30-day PITR on paid. Document the runbook and run a real restore once (SOC 2 evidence).
**P2-3.** `/.well-known/security.txt` with a vuln-disclosure contact.
**P2-4.** Privacy policy + ToS must invoke the FERPA "school official" exception explicitly so districts can adopt.
**P2-5.** Annual pen test (Cobalt / HackerOne, $5–10k). Required for SOC 2 Type II and many state DPAs.
**P2-6.** Vendor/subprocessors page listing Cloudflare, Stripe, Resend, Sentry. Required by SDPC NDPA Exhibit C.

### P0-1 follow-ups (nice-to-have after first merge)

- Nonce-based CSP so `script-src` / `style-src` can move from Report-Only to enforcing. Thread a per-request nonce through `entry.server.tsx` → `root.tsx` → inline script & style tags.
- A `/api/csp-report` endpoint so Report-Only violations become actionable telemetry (forward to Sentry with a PII filter).

---

## Still-open — certifications & agreements

Unchanged from the original review. None of these have been done.

### Tier 1 — sales-blocking

- **SDPC NDPA v2** — free, covers 30+ states. Highest-ROI item on this list. Download from `privacy.a4l.org`, fill Exhibit E (data elements) + Exhibit H (subprocessors: Cloudflare, Stripe, Resend, Sentry). 2–4 weeks legal review. **Not started.**
- **State addenda** — CA SOPIPA, IL SOPPA (requires district-list registration), NY Ed Law §2-d + Parents' Bill of Rights + DSPP (strictest), CT/CO/TN/UT covered by NDPA + riders. **Not started.**
- **Privacy policy + ToS rewrite** invoking FERPA "school official" exception (34 CFR §99.31(a)(1)(i)(B)). **Not started.**

### Tier 2 — procurement moats

- **SOC 2 Type II — Security + Privacy.** Year 1: $33–87k. Timeline: ~3 months to Type I, 6–12 month observation for Type II. Sign with Vanta / Drata / Secureframe. **Not started.**
- **iKeepSafe FERPA badge.** ~$2–4k, 4–8 weeks. Visible trust signal. **Not started.**
- **1EdTech TrustEd Apps.** District-side rubric; increasingly required in IL/TX/FL. **Not started.**

### Tier 3 — optional

- HECVAT-Lite (for higher-ed sales).
- CSA STAR Level 1 (free self-attestation on top of SOC 2).
- State ed-tech "vetted" lists (LearnPlatform, Common Sense Privacy).

---

## Concrete next-step order

1. **This week** — Tackle P0-4 (MFA). Run a staging browser smoke for the merged P0-1 security-header work and watch for CSP Report-Only violations.
2. **Next 2 weeks** — P1-1 (Sentry scrubber), P1-2 (`process.env`), P1-6 (logo MIME sniff), P1-7 (`safeRedirect`), P1-8 (Dependabot + audit CI).
3. **This month** — P1-3 (retention cron), P1-4 (right-to-delete), P1-5 (drop default orgId), P2-3 (security.txt), P2-6 (subprocessors page), and publish the SDPC NDPA v2.
4. **This quarter** — Sign with Vanta/Drata; SOC 2 Type I; iKeepSafe application; first pen test.
5. **6–9 months** — SOC 2 Type II observation window closes.

---

## What was completed in this pass

Summarized here so it doesn't clutter the open list. See each branch for the actual diff.

| # | Finding | How it was fixed |
|---|---|---|
| P0-1 | No HTTP security headers | Enforcing HSTS/X-CTO/X-FO/Referrer-Policy/Permissions-Policy + enforcing CSP for default/img/font/connect/frame/form-action/base-uri/frame-ancestors/object-src + Report-Only CSP for script-src/style-src. `app/lib/security-headers.server.ts` + tests. Follow-up: nonce threading to move script-src/style-src to enforcing. |
| P0-2 | Unsafe CSV importer | New `app/domain/csv/student-roster.server.ts` with RFC-4180 parser, Zod row schema, 5 MB / 10k row caps, header allow-list. Old `app/csvParser/utils.ts` deprecated. |
| P0-3 | PBKDF2 100k below OWASP 2026 | Bumped to 600k. Versioned hash format. Transparent rehash on successful login via `ctx.waitUntil`. Legacy hashes still verify. |
| P0-5 | 8 open npm advisories | All resolved via `overrides` pinning transitives to patched versions within current majors. No code changes, no major bumps. |

---

*End of review. Next pass should start with P0-4.*
