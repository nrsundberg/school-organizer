---
title: "What's new — April 2026"
date: 2026-04-23
slug: whats-new-april-2026
category: "showcase"
---

PickupRoster launched a few weeks ago, and a lot has landed since the first commit. Here's a pass through the things existing tenants will actually notice, grouped by where they live in the app.

## Drills are now templates, with a live takeover view

What used to be "Fire Drill" is now simply **Drills**, and the whole section has been rebuilt around reusable templates. You save a checklist once — fire, severe weather, lockdown, or a custom scenario for your campus — and reach for it the next time, instead of rebuilding the layout from scratch. A new **Library** page at **Admin → Drills → Library** lists every template in your org, with usage counts so you can see which drills get run and which don't.

When a template is actively running, the app drops every signed-in staff member into a shared live view at `/drills/live` until the drill is closed. Nobody ends up staring at the dashboard when the thing that matters is happening on another screen. The printable after-action roster at **Admin → Drills → (template) → Print** has been cleaned up too — no navigation chrome, no headers, just the roster ready for the binder. Old `/admin/fire-drill/...` bookmarks still redirect.

## A real admin for billing, so surprises stay small

Two small banners now show up in the admin layout when they matter. The **plan-usage banner** warns you when you're approaching your tier's limits on students, homerooms, or staff seats, and links straight to the upgrade flow. The **past-due payment banner** appears if Stripe fails to charge your card, with a one-click link into the customer portal so you can fix it before anything interrupts service.

Neither banner appears until it's relevant, so most of the time the admin layout is exactly as quiet as it used to be. Find the billing screens themselves at **Admin → Billing**.

## A public status page, and password reset you can do yourself

PickupRoster now has a public status page at **pickuproster.com/status** — a 90-day uptime grid, the current-status pill, and an incident list, all visible without a login. When the app feels slow, that's the first place to check.

In the same release we shipped **self-serve password reset**. The sign-in page at **pickuproster.com/login** now has a working "Forgot password?" link that sends a one-hour reset token via Resend, using your org's own sender domain when configured. No more emailing support for a manual reset.

## Per-school branding, now including colors

Logo uploads have been around since day one. This month **Admin → Branding** picked up matching color overrides — a primary and an accent hex, validated on save — that flow into the parent-facing screens, the carline display, printed rosters, and billing emails. District tenants can set this per school, so twelve elementaries under one contract can each look like themselves without fighting over a shared palette.

## Marketing site, separated and filled in

The marketing site is now fully split from the tenant app. Prospective schools land on **pickuproster.com** — refreshed **pricing** page, new **FAQs**, and the first two posts on the marketing **blog** ("Reducing car-line wait times with structured lanes" and "Parent communication: confirming pickup changes without chaos"). A matching **guides** section is seeded with operational how-tos like "Upload your school logo and brand colors" and "Inviting staff and setting admin roles."

Signup polish in the background: the `?plan=` query param now survives the multi-step signup form, so clicking *Start free trial* on the Team plan keeps the Team plan selected three screens later, and the post-login redirect lands you back where you came from rather than always on the dashboard.

---

Existing tenants: sign in at **app.pickuproster.com** and try the new Drills library — it's the change most of you will feel first. Not a tenant yet? Start a 30-day free trial at **pickuproster.com/pricing** — no credit card up front.
