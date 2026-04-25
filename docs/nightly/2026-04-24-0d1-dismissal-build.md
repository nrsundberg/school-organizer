# Nightly build — 2026-04-24 (0d.1 dismissal flow)

**Queue item:** `0d.1 — interaction-tests-dismissal — Controller/viewer/history loop spec`
**Branch:** `nightly-build/2026-04-24-0d1-dismissal`
**Agent:** nightly-build (scheduled).
**Base:** `origin/master` @ `fd0db15` (Merge agent-sec/p0-3-pbkdf2-2026-04-24-1445).

## Plan

Land a new end-to-end spec at `e2e/flows/dismissal.spec.ts` that exercises the
controller → viewer → history loop on a seeded tenant: admin POSTs to
`/update/:space` → `Space.status` flips to `ACTIVE` (verified via the fixture's
libsql client); POSTs to `/empty/:space` → `Space.status` returns to `EMPTY`;
`/admin/history` renders the CallEvent row. Extend
`e2e/fixtures/seeded-tenant.ts` with a minimal
`resetBoardForSpace(slug, spaceNumber)` teardown helper so Durable Object /
D1-side leftovers from one spec never surface in the next. The file I expect
to touch: `e2e/flows/dismissal.spec.ts` (new) and
`e2e/fixtures/seeded-tenant.ts` (export the helper + thread it through teardown).

**Acceptance criteria:**
1. `npx playwright test e2e/flows/dismissal.spec.ts` passes locally against the
   staging PLAYWRIGHT_BASE_URL (or against `wrangler dev` for a local dev run).
2. `npm run typecheck` still passes (new files strictly typed against the
   fixture's exports).
3. `npm test` still passes (no unit tests changed).
4. Any behavioral surprise found while writing the spec is flagged in the
   summary under "bugs found during testing" and left as `test.fixme` with a
   pointer to the underlying route / DO code — never papered over with a
   matching assertion, per the queue's quality rule.

**Out of scope:**
- Fixing whatever bugs surface (file a queue entry instead).
- Any of the sibling 0d sub-items (0d.2 signup-to-paid, 0d.3 branding-gate).
- Phase 2 zod+Conform rollout (scheduled task explicitly excludes it).
