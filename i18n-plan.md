# i18n Implementation Plan — pickup-roster

Add multilingual support (English baseline, Spanish as the first additional language) using `i18next` + `react-i18next` + `remix-i18next`. Language preference stored on the `User` record for logged-in users, cookie fallback for everyone else, `Accept-Language` header as initial seed only. Architecture is additive — adding a third language later should be a translator handoff, not another engineering project.

## Why foundation must come first (sequential blocker)

Phase 1 establishes the contract every other piece of work depends on: the namespace shape, the key-naming convention, how `t()` is imported on the client vs. the server, the cookie name, the DB column name, and the signature of the `LanguageSwitcher` component. If two agents start string extraction in parallel without that contract, they'll invent conflicting conventions and we'll spend more time reconciling than translating.

## Phase 1 — Foundation (solo / sequential, ~1 day)

Single-track work. Touches a small number of files, but they're load-bearing.

**Deliverables**

1. Install `i18next`, `react-i18next`, `remix-i18next`, `i18next-browser-languagedetector`, `i18next-http-backend`, `i18next-fs-backend`.
2. `app/i18n.ts` (client init) and `app/i18n.server.ts` (server init with detector chain: cookie → `user.locale` → `org.defaultLocale` → `Accept-Language` → `en`).
3. Wire `I18nextProvider` into `app/root.tsx`. Update root `loader` to return `locale` + initial namespace bundle. Use `useChangeLanguage` so the client follows the loader's language.
4. `public/locales/{en,es}/{common,roster,admin,billing,auth,email}.json` skeleton (empty objects).
5. `i18next-parser` config + `npm run i18n:extract` script that scans `app/**/*.tsx` and writes missing keys to `en/*.json` files.
6. Prisma migration: add `locale String @default("en")` to `User`, `defaultLocale String @default("en")` to `Org`, and `locale String?` to `Teacher` (nullable — most teachers won't have a preference set). Generate via `npm run d1:create-migration`, update `prisma/schema.prisma`, run `prisma generate`. Do NOT apply to remote D1 — that's a deploy step.
7. Build `app/components/LanguageSwitcher.tsx`:
   - Globe icon (lucide-react) + current language's name in its own language ("English" / "Español").
   - HeroUI dropdown, each `<option>` carries a `lang=` attr.
   - On select: writes cookie immediately; if user is logged in, PATCH `/api/user-prefs` to persist `locale`.
   - Used in both `Header.tsx` and the public/caller view header.
8. `app/routes/api/user-prefs.tsx` — extend the existing route with a `locale` field.
9. `app/lib/t.server.ts` — server-only translation helper for use in email templates, Zod errors, anything outside React.
10. `docs/i18n-contract.md` — write down the namespace map, key conventions, interpolation pattern, plural pattern, "how to add a new language" checklist. This is the doc Phase 2 agents will read first.

**Exit criteria:** app runs, all English, language switcher visible with English-only dropdown. `npm run typecheck` green, all existing tests green.

---

## Phase 2 — Parallel extraction (3 subagents, ~1.5–2 days each, run concurrently)

Once Phase 1 is merged, fan out into three independent agents. Each reads `docs/i18n-contract.md` first, then mechanically extracts strings in its assigned area. Each works in its own git worktree to avoid stepping on the others.

### Agent A — Public + caller surfaces

Highest user-visible impact. Smallest blast radius if something breaks.

**Scope**

- `app/routes/_index.tsx` (landing)
- `app/routes/auth/*` (login, forgot-password, reset-password, signup)
- `app/components/MobileCallerView.tsx` and any view-board routes
- `app/components/ImpersonationBanner.tsx`
- Toast messages used in these flows
- Error boundaries / 404 / 500 pages

**Deliverable**

All hardcoded strings replaced with `t()` calls under the `common`, `auth`, and `roster` namespaces. JSON files populated. Visual smoke check: with locale forced to `es`, every key renders (placeholder Spanish like `[ES] Sign in` is fine at this stage — Phase 3 fills in real translations).

**Marketing copy add-on (decided):** Agent A also adds language-support copy to `_index.tsx`, `faqs.tsx`, and `pricing.tsx`. Multilingual support is available on **all plans** (not paywalled) — the pricing copy goes in the shared "everything includes" section, not under any specific tier. All count/list rendering is dynamic from `SUPPORTED_LANGUAGES` so adding a third language requires zero copy edits.

### Agent B — Admin panel

Largest surface area, but conceptually self-contained.

**Scope**

- All `app/routes/admin/*` routes (layout, dashboard, children, drills.library, history, branding, billing)
- Print views: `print.board`, `print.homeroom.$teacherId`, `print.master`
- Admin components: `AdminSidebar`, `AdminUsageBanner`, `PastDuePaymentBanner`
- Form labels / placeholders / help text
- Zod schemas in admin route actions — route through the `errorMap` set up in Phase 1

**Print-route locale rule (decided):**

- `print.board` and `print.master` → use `org.defaultLocale`. Audience is general (posted publicly / staff-wide), not the admin clicking Print.
- `print.homeroom.$teacherId` → use the teacher's `locale` if set on the teacher record, otherwise fall back to `org.defaultLocale`.

Implementation: each print route's loader fetches the appropriate locale alongside its existing data and passes it through. Components call `useTranslation('admin', { lng: printLocale })` where `printLocale` comes from the loader. Centralize the rule in a `usePrintLocale(routeName, teacherId?)` helper to keep the three routes consistent.

**Deliverable**

All admin strings under the `admin` namespace, sub-keyed (`admin.children.*`, `admin.drills.*`, etc.). Print routes flagged + handled.

### Agent C — Server-side strings

Different mental model from React extraction — no hooks, explicit `lng` parameter on every `t()` call. Best handled by an agent focused only on this layer.

**Scope**

- `app/domain/email/templates/*` (welcome, password-reset, mid-trial-checkin, trial-expiring) — confirm `interpolate.ts` plays nicely with i18next placeholder syntax
- Zod error map wiring across `app/lib/forms.server.ts` and route actions
- Stripe checkout: pass `locale` param in `app/domain/billing/checkout.server.ts`
- Better-auth error message mapping — build a code→translation-key lookup table (their messages stay in English upstream, we map at the boundary)
- `throw new Response("...", { status, statusText })` calls and any thrown errors surfaced to users
- Trial/billing notification email subjects + bodies
- Status page strings, if user-visible

**Deliverable**

Every server-side user-facing string keyed under the appropriate namespace (`email.*`, `billing.*`, `auth.errors.*`). Email-template tests still pass. Stripe receives the right `locale`.

---

## Phase 3 — Translation + verification (sequential, ~1 day)

By this point `public/locales/en/*.json` is complete and the `es/*.json` files have placeholder text.

1. **Spanish translation pass.** Hand JSON files to a translator (or do a draft pass through a translation service, then native-speaker review). School-domain terminology matters — "pickup", "dismissal", "fire drill", "homeroom" don't all translate cleanly. Maintain `docs/i18n-glossary.md` for consistency across files.
2. **Verification subagent.** Single agent, narrow job:
   - Force `lng=es` cookie, walk every major route, list any English leaks.
   - `npm run typecheck`, `npm test`, `npm run test:e2e` — all green.
   - Confirm switcher persists across navigation, refresh, login, logout.
   - Snapshot test that emails render correctly in Spanish.
3. **Rollout flag.** Gate the language switcher behind an env var for ~1 week so the infrastructure ships independently of the Spanish content. Flip the flag once translation review is signed off.

---

## Shared contract for Phase 2 agents

Recommend writing these into `docs/i18n-contract.md` and pinning them at the top:

- **Key naming:** `<namespace>.<feature>.<element>` — e.g. `admin.children.addButton`, `auth.login.passwordPlaceholder`. Never use full sentences as keys.
- **Interpolation:** `t('roster.pickedUpBy', { name: parent.name })`, never template literals.
- **Plurals:** i18next's `count` parameter, never branching in component code.
- **One JSON file per namespace per language.** Don't subdivide further — too many files becomes a load problem on Workers.
- **Don't translate user-generated data** (kid names, school names, parent names, custom drill names). Only UI chrome.

A 15-minute sync at the start of Phase 2 (or a shared thread) for edge cases is cheaper than reconciling three different conventions later.

---

## Out of scope (explicit non-goals)

- URL-based language routing (`/es/admin/...`) — decided against in design discussion.
- RTL languages (Arabic, Hebrew) — not on the roadmap; Tailwind has `rtl:` variants when we get there.
- Localized currency display beyond `Intl.NumberFormat` defaults — defer until a non-USD market is targeted.
- Translating Better-auth internals upstream — we map their codes at the boundary.
- Translating server logs, Sentry messages, admin-only debug surfaces — English only is fine.

---

## Total effort

Roughly **5–7 working days of effort**. Calendar time is much shorter because Phase 2's three agents run in parallel:

| Phase | Effort | Sequencing |
|---|---|---|
| 1 — Foundation | 1 day | sequential, blocker |
| 2 — Extraction (3 agents) | 1.5–2 days each | parallel |
| 3 — Translation + verification | 1 day | sequential |

Rough calendar estimate: ~4 days end-to-end.
