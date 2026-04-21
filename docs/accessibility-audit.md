# Accessibility Audit — Pickup Roster

**Standard:** WCAG 2.1 AA
**Date:** 2026-04-20
**Scope:** Marketing pricing page, tenant car-line board (`/`), admin layout + billing

## Summary

**Issues found:** 10 &nbsp;|&nbsp; **Critical:** 2 &nbsp;|&nbsp; **Major:** 4 &nbsp;|&nbsp; **Minor:** 4

Of the 10 findings, **8 were fixed in this audit** (marked ✅). Two remain as
backlog cleanup (platform admin pages and a handful of `text-white/40`
labels/placeholders on internal-only screens).

## Findings

### Perceivable

| # | Issue | WCAG | Severity | Recommendation | Status |
|---|---|---|---|---|---|
| 1 | `<Send />` icon on active parking tiles has no accessible name — screen readers announce only the space number, losing the "car is here" meaning | 1.1.1 / 4.1.2 | 🟡 Major | Add `aria-hidden="true"` to the icon and put the active/empty status in the tile's `aria-label` | ✅ Fixed in `app/routes/_index.tsx` |
| 2 | Footer copyright and left-column subtitle used `text-white/50` on `#0f1414` (~4.1:1 — borderline normal text) | 1.4.3 | 🟢 Minor | Bump to `text-white/70`/`text-white/80` | ✅ Fixed in `app/components/Footer.tsx` |
| 3 | Admin billing Stripe disclaimer used `text-white/40` (~3.0:1) on dark panel — fails 4.5:1 for small text | 1.4.3 | 🟡 Major | Raise to `text-white/65` | ✅ Fixed in `app/routes/admin/billing.tsx` |
| 4 | `/billing-required` "Need help?" help text used `text-white/40` on dark bg | 1.4.3 | 🟡 Major | Raise to `text-white/70` | ✅ Fixed in `app/routes/billing-required.tsx` |
| 5 | Platform admin pages (internal `/platform/*`) have multiple `text-white/40` placeholders, empty-state copy, and audit row labels | 1.4.3 | 🟢 Minor | Internal tooling; raise in a follow-up sweep — does not block external users | ⏸ Deferred |

### Operable

| # | Issue | WCAG | Severity | Recommendation | Status |
|---|---|---|---|---|---|
| 6 | Parking tile EMPTY state (permitted user) was a `<div>` with `onClick` — not reachable or activatable via keyboard | 2.1.1 | 🔴 Critical | Convert to `<button type="button">` | ✅ Fixed in `app/routes/_index.tsx` |
| 7 | Parking tile ACTIVE state (permitted user) used a `<div>` inside `PopoverTrigger` — HeroUI's trigger forwards keyboard semantics, but the underlying node should be a button | 2.1.1 / 4.1.2 | 🔴 Critical | Convert trigger child to `<button type="button">` | ✅ Fixed in `app/routes/_index.tsx` |
| 8 | Parking tile default height was `min-h-[30px]` — below the 44×44 CSS px minimum on mobile | 2.5.5 | 🟡 Major | Bump non-compact tiles to `min-h-[44px]` on small screens (`md:min-h-[30px]` preserves dense desktop grid); compact view for controllers intentionally stays small | ✅ Fixed in `app/routes/_index.tsx` |
| 9 | No skip-to-main-content link — keyboard users have to tab through the site header on every navigation | 2.4.1 | 🟡 Major | Add visually-hidden-but-focusable skip link pointing to `#main-content`; wrap `<Outlet />` in `<main id="main-content">` | ✅ Fixed in `app/root.tsx` |
| 10 | Pricing billing-cycle radio buttons relied on default browser focus outline (nearly invisible on the yellow selected state) | 2.4.7 | 🟢 Minor | Add `focus-visible:ring-2 focus-visible:ring-[#E9D500]` | ✅ Fixed in `app/routes/pricing.tsx` |

### Understandable

| # | Issue | WCAG | Severity | Recommendation | Status |
|---|---|---|---|---|---|
| 11 | Homeroom filter input used `<p>` as a visual label — no programmatic association, assistive tech announces the input with no name | 3.3.2 / 4.1.2 | 🟡 Major | Swap to `<label htmlFor="homepage-homeroom">` and add matching `id` on the input | ✅ Fixed in `app/routes/_index.tsx` |

### Robust

| # | Issue | WCAG | Severity | Recommendation | Status |
|---|---|---|---|---|---|
| 12 | Parking tiles had no accessible label — screen readers only heard the raw number | 4.1.2 | 🟡 Major | Add `aria-label` with full context (`"Space N — active. Open actions."`) | ✅ Fixed in `app/routes/_index.tsx` |

## Color Contrast Check

| Element | Foreground | Background | Ratio | Required | Status |
|---|---|---|---|---|---|
| Marketing body copy (`text-white/70`) | rgba(255,255,255,.70) | #0f1414 | ~9.1:1 | 4.5:1 | ✅ |
| Marketing tertiary (`text-white/65`) | rgba(255,255,255,.65) | #0f1414 | ~8.5:1 | 4.5:1 | ✅ |
| Pricing cycle-label (`text-white/60`) | rgba(255,255,255,.60) | #0f1414 | ~7.7:1 | 4.5:1 (small) | ✅ |
| Footer copyright (was `/50`, now `/70`) | rgba(255,255,255,.70) | #0f1414 | ~9.1:1 | 4.5:1 | ✅ |
| Admin fine-print (was `/40`, now `/65`) | rgba(255,255,255,.65) | #151a1a | ~7.9:1 | 4.5:1 | ✅ |
| Active-tile yellow on navy | #193B4B | #E9D500 | ~7.7:1 | 4.5:1 | ✅ |
| Empty-tile white on navy | #FFFFFF | #193B4B | ~11.0:1 | 4.5:1 | ✅ |
| CTA yellow text on dark | #E9D500 | #0f1414 | ~13.0:1 | 4.5:1 | ✅ |

## Keyboard Navigation

| Element | Tab Order | Enter/Space | Escape | Notes |
|---|---|---|---|---|
| Skip link (new) | First | Jumps focus to `#main-content` | — | ✅ |
| Marketing nav | Logo → Pricing → FAQs → Login → Sign up | Activates link | — | ✅ |
| Pricing monthly/annual toggle | After nav | Toggles cycle | — | ✅ with new focus ring |
| Pricing Sign up / Start subscription | After toggle | Navigates / submits | — | ✅ |
| Parking tile EMPTY (permitted) | Tab-reachable now | Marks active | — | ✅ (was critical a11y blocker) |
| Parking tile ACTIVE (permitted) | Tab-reachable | Opens popover | Closes popover | ✅ (HeroUI Popover handles Escape + focus return) |
| Homeroom filter (new `<label>`) | After board on viewer sidebar | — | — | ✅ associated label |
| Admin sidebar / mobile drawer | `aria-label`s present | — | — | ✅ |

## Screen Reader Behavior (post-fix, expected announcements)

| Element | Announced As |
|---|---|
| Skip link (focused) | "Skip to main content, link" |
| Pricing toggle | "Billing cycle, radio group. Monthly, radio button, selected." |
| Empty parking tile | "Space 14 — empty. Activate to mark active. Button." |
| Active parking tile | "Space 14 — active. Open actions. Button." |
| Homeroom filter | "Filter Homeroom, combobox, empty." |
| Footer support | "Support, link, mailto:support@pickuproster.com" |

## Priority Fixes (applied)

1. **Parking tiles are now keyboard-operable** (#6, #7) — was blocking any controller/admin using assistive tech from calling cars.
2. **Skip link + `<main>` landmark** (#9) — lets keyboard and screen-reader users bypass the header on every page.
3. **Form label associations + icon labels** (#1, #11, #12) — makes the filter and tile states comprehensible to screen readers.
4. **Touch targets + focus rings** (#8, #10) — practical mobile usability and visible keyboard focus on the yellow selected state.
5. **Contrast bumps on billing/footer copy** (#2, #3, #4) — small text over dark panels now clears 4.5:1.

## Follow-up Backlog

- Audit remaining `text-white/40` uses across `app/routes/platform/*` (internal admin tooling) — bump to `/60`–`/70` on text blocks, leave decorative chevrons alone.
- Screen reader test pass on a real device (VoiceOver on iOS + NVDA on Windows) — my audit is a static analysis; some announcements only surface under live AT.
- Zoom to 200% pass — verify the pricing grid and parking board reflow cleanly. Hasn't been checked in this audit.
- Consider adding `aria-live="polite"` on the recent-queue widget so screen-reader users know when a new car is called.
