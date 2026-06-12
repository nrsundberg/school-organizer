---
title: "What's new — May 2026"
date: 2026-05-01
slug: whats-new-may-2026
category: "showcase"
---

A lot landed in the back half of April — district rollups, real-time drills, and Spanish across the admin app being the biggest three. Here's a pass through what existing tenants will notice, grouped by where each change lives.

## Districts: one contract, every school underneath it

PickupRoster now has a first-class **District** layer. If you run more than one campus under a single agreement — a unified district, a charter network, a private K-8 with two buildings — each school keeps its own admins, branding, and roster, but a district admin gets a rollup view across all of them. Sign in at **district.pickuproster.com** (or your district subdomain) for a dashboard with per-school student and staff counts, billing status, and the school list.

District admins can step into any school they own without sharing a password — there's a one-click impersonation button on each school card, and an end-impersonation control that drops you straight back to the district console. Every step into and out of a school is recorded in the **District → Audit log** page, with IP and user agent attached, so the trail is auditable end-to-end. Billing for the whole district lives at **District → Billing**, with a single Stripe customer portal for the contract.

Existing single-school tenants are untouched — the district layer only appears if your account is part of one.

## Drills now run live, with everyone on the same screen

The drills section got a major rebuild. When a drill starts, every signed-in staff member is automatically pulled into a shared live view at **/drills/live**. You can see who else is currently watching (presence), follow the activity feed as classrooms mark themselves accounted-for, and end the drill with a sign-off attestation that's stamped to the run record. State syncs over WebSockets, so a tile someone marks on a tablet at the front gate updates on the principal's laptop within the same second.

After-action review got better too. **Admin → Drills → History → (run)** now plays back the whole drill on a timeline — every mark, every spot-call, every status change in the order it happened, with the actor's name on each event. If a drill was run during an impersonation session, the timeline shows the underlying admin, not just the impersonator.

## Spanish, across the entire admin app

The marketing site has had a language switcher for a while. This release pushes Spanish translations through the rest of the app: the admin dashboard, the users, students, children, households, and student-detail pages all render in Spanish for staff who pick it from the profile menu. Translations happen on the server, so the first paint is already in the right language — no flash of English keys before hydration.

## Family-owned space numbers

A long-running ask from operators with assigned-spot lots: each household can now own its own pickup space number, set once at **Admin → Households → (family) → Space**. The carline display, the controller board, and the printed master sheet all read the family-owned space when one is set, and fall back to whatever spot the parent picked today when one isn't. Drill soft-delete also landed alongside this — accidental deletions of a drill template are now recoverable from the trash for 30 days.

## Self-serve profile, magic-link invites, and a quieter signup

Three smaller wins worth flagging. Every school and district user now has a **Profile** page (top-right menu → Profile) for changing their name, email, and password without a support ticket. Staff invites are now sent as one-click magic links from Resend instead of a temporary password — invitees set their own password on the way in. And the signup flow no longer round-trips through Stripe Checkout for paid plans: pick a plan, finish signup, and you're inside the app immediately, with the upgrade affordance handled in-app from **Admin → Billing**.

---

Existing tenants: log in at **app.pickuproster.com** and try the live drills view — it's the change most teams will feel first. If you're running more than one school and don't have a district set up yet, reply to this email and we'll attach your existing schools to a new district contract. Not a tenant yet? Start a 30-day free trial at **pickuproster.com/pricing** — no credit card up front.
