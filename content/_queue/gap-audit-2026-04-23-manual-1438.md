---
date: 2026-04-23
generated_by: "weekly-content-gap-audit-manual-1438"
---

# PickupRoster — Content Gap Audit

Audit of shipped features, recent commits, and existing content. Current library: 1 blog post (`content/blog/2026-04-22-reducing-car-line-wait-times-with-structured-lanes.md`) and 1 guide (`content/guides/2026-04-22-upload-school-logo-and-brand-colors.md`). Routes scanned under `app/routes/` — 60+ files covering admin, auth, drills, billing, homerooms, platform, and marketing surfaces.

## Features with no documentation

Every shipped surface below has a live route and a real title in `meta`, but zero blog or guide coverage:

- **Drill templates** (`app/routes/admin/drills.library.tsx`, `admin/drills.$templateId.tsx`, `admin/drills.$templateId.run.tsx`, `drills.live.tsx`) — authoring, running, and live-state broadcasting for fire / lockdown / reunification drills. Large surface, zero content.
- **Admin history & reports** (`admin/history.tsx`) — daily pickup reports and audit trail. No "how to read your dismissal report" guide.
- **Homeroom & student management** (`homerooms.tsx`, `homerooms.$id.tsx`, `create/create.homeroom.tsx`, `create/create.student.tsx`, `edit/edit.homeroom.$value.tsx`, `edit/edit.student.$value.tsx`) — the core roster workflow. No setup guide.
- **Viewer access** (`viewer-access.tsx`) — read-only carline display link. Never explained publicly.
- **Users & roles** (`admin/users.tsx`) — Owner / Admin / Staff / Dispatcher permission model. No "who should have which role" guide.
- **Billing, pricing, plan usage** (`pricing.tsx`, `admin/billing.tsx`, `billing.success.tsx`, `billing.cancel.tsx`, `billing-required.tsx`) — plan tiers + usage meters are live (`buildUsageSnapshot`) but undocumented for buyers.
- **Signup flow with `?plan=`** (`auth/signup.tsx`) — just patched (`5b2060a`) to preserve plan across steps; no funnel-matching landing content.
- **Print surfaces** (`admin/print.board.tsx`, `print.master.tsx`, `print.homeroom.$teacherId.tsx`, `print.drills.$templateId.tsx`) — Thursday backup-plan material ("what to do when the WiFi dies") with no guide.
- **FAQs page** (`faqs.tsx`) — route exists but no SEO-worthy Q&A content referenced in the queue.

## Blog topic gaps

Common industry / competitor angles absent from the blog:

- Severe-weather and indoor-dismissal protocols.
- Morning arrival / drop-off mirror of the dismissal playbook.
- Parent communication during dismissal delays (text trees, app pushes, who owns the mic).
- Lockdown, fire, and reunification drill SOPs — directly tied to our drill-templates feature.
- Walker, bike, and bus-loop coordination with car line.
- Kindergarten first-week dismissal (the single hardest week of the year).
- Early-dismissal and half-day operations.
- ADA / mobility-impaired pickup lanes.
- After-school-care handoff and late-pickup policy.
- Staffing ratios for dismissal — which roles actually matter.

## Recent shippings needing showcase

Commits from the last 30 days with no blog / guide / showcase entry:

- `acfcedb feat: drill templates rename + live state, mobile smoke sweep` — drill-templates feature is fully shipped with live broadcast; no guide, no showcase post.
- `c8f0685 feat(blog): marketing blog index + post routes` — blog infra itself shipped; the launch was never itself announced.
- `d104991 feat(forms) / b1b2273 feat(forms): useAppForm + parseForm helpers` — internal, no external showcase needed, but worth a dev-blog entry if we start one.
- `5b2060a fix(signup): preserve ?plan= across step transitions` — unlocks plan-specific landing pages, which we don't yet have.
- `b4719da fix(ci): wire staging D1` + `fb024db infra: AGENTS.md + staging env` — internal infra; no external content needed.

## Priority ranking — top 5 next pieces

1. **Guide — "Setting up your first drill template"** (type: guide). Rationale: biggest shipped-but-undocumented surface, directly tied to `acfcedb`. Covers `admin/drills.library` → `drills.$templateId` → `drills.live`. Blocks adoption of the feature we most recently shipped.
2. **Blog — "Running a lockdown drill without scaring the kids: a principal's checklist"** (type: blog). Rationale: high-intent SEO term, maps 1:1 to drill-templates feature, extends the dismissal-playbook voice established by the car-line post.
3. **Guide — "Invite your staff and pick the right role"** (type: guide). Rationale: every new tenant hits `admin/users.tsx` in week 1; the Owner/Admin/Staff/Dispatcher model is non-obvious. Supports the signup-funnel fix (`5b2060a`).
4. **Showcase — "What's new in PickupRoster: drill templates + live state"** (type: showcase/changelog). Rationale: surfaces `acfcedb` to existing customers and gives the just-shipped blog infra (`c8f0685`) something to index.
5. **Blog — "The Thursday-afternoon WiFi-is-down dismissal plan"** (type: blog). Rationale: justifies the `print.*` routes we've built, pairs naturally with the car-line lanes post, and addresses a real fear that keeps schools on paper.

## Notes

Filename references use paths relative to the repo root. Drill templates and roles were chosen over billing for #1–#3 because billing is self-serve and has in-product copy, whereas drills and roles are where support tickets will land first.
