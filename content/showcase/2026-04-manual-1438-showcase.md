---
title: "What's new — April 2026"
date: 2026-04-23
slug: whats-new-april-2026
category: "showcase"
---

A quick tour of what shipped in PickupRoster over the last thirty days. Nothing flashy — mostly things that make the day-to-day running of a school feel a little less like spinning plates.

## Drill templates got a library, a live mode, and a clean print view

The biggest change this month is that "Fire Drills" is now simply **Drills**, and the whole section has been rebuilt around reusable templates. You can save a template once — fire, severe weather, lockdown, a custom one for your campus — and reach for it the next time you run that drill instead of rebuilding the checklist from scratch. A new **Library** page lists every template you've saved, with usage counts so you can see which ones actually get used.

When a drill is *running*, PickupRoster now enters a live takeover mode: every signed-in staff member in your org gets routed to the live drill view until it's closed out, so nobody is stuck on a different screen during the thing that matters most. Parents and viewers aren't affected. And because an after-action report is often the whole point of a drill, there's a rebuilt printable roster at **Admin → Drills → (a template) → Print** that produces a clean page without any of the app chrome.

If you've been linking to `/admin/fire-drill/...` from your emergency binder, those URLs still redirect — but you can update them to `/admin/drills/...` on your next revision.

## Plan-usage and past-due banners, so you're not surprised by billing

Admins now see two small, honest banners in the admin layout when they're relevant.

The first is a **plan-usage banner** that shows how close you are to your current tier's limits — students enrolled, homerooms configured, seats in use. It only shows up when you're within shouting distance of the cap, and it links straight to the upgrade page. No marketing fluff, just a heads-up.

The second is a **past-due payment banner** that appears if a Stripe charge has failed and your subscription is in a grace window. It tells you exactly what to do (open the Stripe portal, update the card) instead of waiting for a support email a week later.

Find both on any page under **Admin**.

## A public status page, and self-serve password reset

We launched a public **status page** at [pickuproster.com/status](https://pickuproster.com/status) — uptime grid for the last 90 days, an incident list, and a pill at the top telling you the current state. The idea is simple: when something is slow, you shouldn't have to email us to find out whether it's you.

In the same release, we finally shipped **self-serve password reset**. Before, if an admin forgot their password, they had to email us to get a reset link. Now they click **Forgot password?** on the sign-in screen and get a reset email via Resend, using the same domain as the rest of your PickupRoster mail. Reset links expire after an hour.

## Per-school color overrides in branding

Logo uploads have been around since launch, but this month **Admin → Branding** got a matching set of color overrides. You can now set a primary and accent hex color alongside your logo, and every surface the logo shows up on — parent app header, the carline display, printed reports, billing emails — picks up the new palette. District tenants can set this per school, so a district of twelve elementaries can each have their own identity without fighting over a single brand.

## Marketing site polish

A few smaller changes that mostly affect prospective schools, not existing ones:

The marketing site at [pickuproster.com](https://pickuproster.com) is now fully separated from the in-app experience, with a refreshed **pricing** page, a new **FAQs** page, and our first marketing **blog post** on reducing car-line wait times with structured lanes. The signup flow now preserves your `?plan=` choice across the multi-step form — if you clicked "Start free trial" on the Team plan, the Team plan is still selected three screens later. And the login redirect has been fixed so you land back where you started instead of on the dashboard.

---

Existing tenants: sign in at [app.pickuproster.com](https://app.pickuproster.com) and try the new Drills library — it's the change most of you will feel first. Not a customer yet? Start a 30-day free trial at [pickuproster.com/pricing](https://pickuproster.com/pricing), no credit card required.
