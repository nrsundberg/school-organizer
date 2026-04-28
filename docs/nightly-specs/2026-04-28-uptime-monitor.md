# Research spec — #6 uptime-monitor

**Author:** polish agent, 2026-04-28.
**Workstream:** Priority 2, item #6 in `docs/nightly-queue.md`.
**Status:** research only — no code changed in this run. Per the queue's inline scope ("research + config, not code"), this doc IS the deliverable; the only follow-up code work is small (one new probe entry + a `docs/incidents/` template referenced from alerts), and it's optional from this spec's standpoint.
**Depends on:** nothing in flight. The internal `/status` page (`app/routes/status.tsx`, `app/domain/status/components.ts`) and `/api/healthz` already exist and are stable surfaces an external monitor can probe.
**Companion to:** `docs/ops-runbook.md` § "Communication tree" item 3, which is the placeholder this spec replaces.

---

## Problem

Pickup Roster has zero **external** uptime monitoring today. If `pickuproster.com` returns 500 to every parent at 2:55 PM on a Friday, nothing pages Noah — he finds out when an admin emails or calls. The ops-runbook flags this in the communication tree ("Uptime monitor alerts: see queue item 6 — once wired, alerts email noahsundberg@gmail.com + page a Slack webhook") but the wiring itself was punted to this workstream.

We need three things, in priority order:

1. **Outage detection within ~3 min**, not "we noticed when a parent texted." The dismissal window is 2:30–3:30 PM in most pilot schools; even five minutes of silent downtime there is a reputational hit that survives multiple uptimes-since.
2. **Alerts that actually wake Noah up.** Email-only is not enough — Noah's phone is on Do Not Disturb during dismissal in his other commitments. A second channel (Slack mobile push or SMS) is required.
3. **Public-facing artifact** a pilot admin can point at to see "is it just me?" without DMing support. The internal `/status` page already covers this *if the Worker is up*. An external monitor's status page is the fallback for when our own Worker can't respond — the case our internal page structurally cannot cover.

The queue scope already pins the deliverable shape (compare three providers, pre-draft checks, document alert wiring). This spec fills in the implementation reality the build agent (or Noah, doing the account creation himself) will hit.

## Current state

### What already exists in repo

- **`/api/healthz`** at `app/routes/api/healthz.ts` — returns `{ ok: true, ts: <iso>, env: <"production"|"staging"|...> }` with `Cache-Control: no-store`. Stable, no DB read, no auth. Perfect external probe target — it exercises the Workers runtime + JSON serialization without touching D1, so a passing healthz with a failing `/status` localizes the fault to D1 vs. the Worker.

- **Internal `/status` page** at `app/routes/status.tsx` + `app/domain/status/{components,probes,service}.server.ts`. Component registry covers application/data/email/payments/tenants sections. Probed by the `*/2 * * * *` cron in `wrangler.jsonc > triggers.crons` (handler in `workers/app.ts` > `runStatusProbes`). Outputs cached via `s-maxage=30, stale-while-revalidate=120`. **Important:** this is *self-reporting* and goes dark with the rest of the Worker if Cloudflare loses our zone. External monitoring is the missing complementary signal.

- **`SUPPORT_EMAIL`** env var (`support@pickuproster.com`) in `wrangler.jsonc > vars`. Useful as the third notification target after Noah's personal email + Slack — if Noah is unreachable, support inbox sees the page.

- **Sentry** is wired (`workers/app.ts` `withSentry(...)`, `app/entry.client.tsx`). Sentry catches *application errors*; it does not catch "the Worker is unreachable" — Sentry's dashboard goes silent when the app does, which is the worst possible UX during an outage. External monitor and Sentry are complementary, not redundant.

- **`docs/ops-runbook.md`** § "Communication tree" item 3 already references this workstream by name; alerts will land in the runbook's existing incident-response flow with no edits needed.

- **Cron infrastructure** is in place (`*/2 * * * *`) — if we ever decide to write our own minimal external monitor (e.g., a separate Worker on a separate Cloudflare account that probes pickuproster.com), the pattern is well-established. Not the recommendation here — see "Build vs. buy" below — but worth noting it's an option.

- **`PUBLIC_ROOT_DOMAIN`** = `pickuproster.com`, **MARKETING_HOSTS** includes `school-organizer.sundbergne.workers.dev` (the workers.dev fallback). Both are external probe targets that exercise different parts of Cloudflare's routing layer — a `pickuproster.com` failure with `school-organizer.sundbergne.workers.dev` healthy localizes to DNS / Custom Domain, not the Worker.

### What does not exist

- No external uptime monitoring of any kind.
- No `docs/incidents/` directory yet (referenced as a future thing in ops-runbook). First real outage triggers its creation; the alert payload should include a one-line link to the runbook's "Post-incident" section so whoever's on it knows where the markdown file goes.
- No Slack workspace wired to a webhook. Noah does run a Slack workspace (per ops-runbook references) but no incoming webhook is documented. Step 0 of wiring is creating the webhook; it's a Slack-admin click, not code.
- No status-page hosted by the monitor (UptimeRobot's free PSP; BetterStack's status-pages product). Pilot schools don't yet have a "status.pickuproster.com" to point at.

## Build vs. buy

Building our own external monitor is a one-evening project (a separate Worker on a separate Cloudflare account, probing the prod Worker every 2 min, posting to Slack on failure). The reason **not** to do it: the *failure case the external monitor exists to catch* is "Cloudflare's serving our zone broken." A monitor running on the same provider as the thing it's monitoring fails for the same reason its target does, exactly when you need it most. Buying from a different cloud (UptimeRobot is on AWS, BetterStack on Hetzner + AWS, Cronitor on AWS + GCP) gets us out of that single-vendor failure mode for the pager itself.

The cost difference is also negligible at our scale ($0–$25/month vs. ~$0 to self-host plus the ongoing maintenance burden). Recommendation below: **buy**, pick one vendor, document the config so we could switch later.

## Provider comparison

Pricing checked 2026-04-28. Tier names sometimes shift; confirm at signup.

| Capability | UptimeRobot | BetterStack (formerly Better Uptime) | Cronitor |
|---|---|---|---|
| Free-tier monitor count | 50 | 10 | 5 |
| Free-tier check interval | 5 min | 3 min | 1 min (heartbeat) / 5 min (uptime) |
| Paid first tier | $7/mo (Solo): 50 monitors at 1 min | $25/mo (Team): 50 monitors at 30 s | $10/mo (Hobbyist): 100 jobs |
| Notification channels (free) | Email, webhook, Slack (via webhook) | Email, Slack, Telegram, webhook, MS Teams | Email, Slack, webhook |
| Phone calls / SMS | Paid only ($25+/mo) | Phone + SMS on free tier (limited count); unlimited on paid | SMS on paid tier |
| On-call rotations | Paid only | Yes, including paid free-tier-adjacent | No |
| Public status page | 1 free (basic), branded paid | Paid only ($25+/mo) | Paid only |
| Keyword match in body | Yes | Yes | Yes |
| Multi-region probe | 6 regions (paid only on free) | Paid: 5 regions baseline | Yes (paid) |
| API + Terraform/IaC | Public API, no Terraform | Terraform provider, public API | Public API |
| Status page custom domain | Paid | Paid | Paid |
| Where it's hosted (failure-correlation) | AWS | Hetzner + AWS | AWS + GCP |
| Notable caveat | Free tier shows ads on the public status page | Better incident-management features (acknowledge, on-call) but pricier | Strongest at *cron heartbeat* monitoring; weaker at HTTPS endpoint monitoring |

### Recommendation: BetterStack (free tier) for now, plan to upgrade to BetterStack Team ($25/mo) by pilot #3.

**Why BetterStack over UptimeRobot,** even though UptimeRobot is the well-known free option:

- 3-min check interval (vs. 5-min) on free tier — closes the detection gap inside the dismissal window. With UptimeRobot's 5-min interval, an outage that begins at 2:55 PM is detected at 3:00 PM at earliest, mitigated at 3:05+ — past peak dismissal. BetterStack catches it at 2:58.
- Phone + SMS on free tier (limited monthly count) — UptimeRobot puts these behind the $25/mo wall. The whole point is to reach Noah when email is missed.
- Slack + Telegram + webhook all on free — same as UptimeRobot.
- Better incident-management UX (acknowledge, on-call rotations, post-mortems) when we eventually upgrade.
- Slightly more *external* relative to our stack: BetterStack runs primarily on Hetzner; UptimeRobot is AWS like much of the internet. If a wide AWS outage takes us down it's at least possible BetterStack still pages.

**Why not Cronitor:** strongest fit is for monitoring our own scheduled jobs (the `*/2 * * * *` status probes cron, the `0 10 * * *` billing cron). Worth adding *in addition* to BetterStack later, but as the primary uptime monitor it's the wrong shape — only 5 free monitors, and HTTPS uptime checks are not its lead use case. Future-spec material.

**Why not UptimeRobot:** purely a 5-min vs 3-min interval and free-tier phone/SMS — neither is fatal, both are real downgrades. If BetterStack's free monitor count (10) ever becomes a constraint before we upgrade, switching to UptimeRobot's 50-monitor free tier is the obvious cheap fallback, with the explicit tradeoff that detection latency goes from 3 min to 5 min.

The 10-monitor free-tier limit on BetterStack is enough for the pre-drafted checks below (we currently sit at 7), with headroom for two new pilot tenants before we have to upgrade. The upgrade trigger: when monitor count would exceed 10. That's "pilot #3 onboarded with their own subdomain monitor."

## Pre-drafted checks

Each row is one BetterStack monitor. Order by criticality so the dashboard reads top-down.

| # | Name | URL | Method | Expected | Interval | Notes |
|---|---|---|---|---|---|---|
| 1 | Marketing apex | `https://pickuproster.com/` | GET | 200, body contains `Pickup Roster` | 3 min | Identical to internal `marketing` probe in `app/domain/status/components.ts`; keep both substrings in lockstep when the marketing hero copy changes. |
| 2 | App healthz | `https://pickuproster.com/api/healthz` | GET | 200, body contains `"ok":true` | 3 min | Cheapest probe; runs no DB code. First to recover after a Worker push, last to fail before a full outage. |
| 3 | Auth page | `https://pickuproster.com/login` | GET | 200, body contains `Sign in` (or matching i18n; verify after the i18n PR lands) | 3 min | Exercises session middleware and a D1 read for the org-by-host lookup, so a green here means D1 + Worker + edge are all OK. |
| 4 | Status page | `https://pickuproster.com/status` | GET | 200, body contains `Status` heading | 3 min | Self-reference: external monitor verifies our public status page renders. If `/status` 500s while `/api/healthz` is 200, the bug is isolated to the status loader. |
| 5 | Staging apex | `https://staging.pickuproster.com/api/healthz` | GET | 200, body contains `"env":"staging"` | 5 min | Lower priority — staging breakage isn't customer-visible, but a regression here predicts prod by ≤24 h. Longer interval saves a monitor slot. |
| 6 | Workers.dev fallback | `https://school-organizer.sundbergne.workers.dev/api/healthz` | GET | 200, body contains `"ok":true` | 5 min | Localizes Custom Domain / DNS faults. If `pickuproster.com` is down but `*.workers.dev` is up, the fault is at the Cloudflare zone layer, not the Worker code. Operational signal even if it never fires. |
| 7 | Pilot tenant board | `https://demo.pickuproster.com/` | GET | 200, body contains `Pickup Roster` (or the demo's branded title) | 3 min | One representative tenant subdomain, exercising wildcard routing + per-tenant `resolveOrgByHost`. **Requires:** the `demo` tenant from queue item #7 (demo-sandbox) actually exists. **If demo isn't seeded yet,** point this at a real pilot subdomain Noah designates (read-only board pages don't expose PII, and the monitor only does GET). |

**Total: 7 monitors.** Free tier holds; 3 monitors of headroom before the upgrade trigger.

### Checks **not** included, with reason

- **Full signup flow.** Tempting (it's the conversion-critical journey) but it requires real Stripe traffic and a tenant teardown step on each run; not worth the operational complexity at this stage. Synthetic flow checks belong on a `playwright.staging.config.ts` cron, not the uptime monitor.
- **`{slug}.pickuproster.com` per pilot tenant.** One representative tenant (the `demo` row above) catches the wildcard-routing class of bug at zero monitor budget. Per-pilot checks are a pilot #3+ refinement, when a tenant-specific 500 starts being a thing we can't tell from the aggregate.
- **WebSocket / Durable Object reachability.** Hard to probe externally without Playwright; covered by the internal `/status` `tenants_aggregate` probe.
- **Stripe / Resend / Sentry.** Out-of-scope third-parties already have their own status pages; the internal `/status` page subscribes to `https://www.stripe-status.com/api/v2/status.json` for Stripe. Adding external probes for them just increases noise.

## Alert wiring

Three channels, in escalation order. Configure on the BetterStack alert policy attached to monitors 1–4 (the four high-priority probes); monitors 5–7 fire to Slack only — they're informational, not pager-grade.

### 1. Slack webhook (primary)

- **Purpose:** Loud, immediate, free. Slack is where Noah lives.
- **Setup:** In the Slack workspace, create an incoming webhook for a new `#alerts-pickuproster` channel. Copy the webhook URL into BetterStack > Integrations > Slack. (Alternative: install BetterStack's first-party Slack app — better UX, requires admin OAuth.)
- **Payload:** monitor name, status (DOWN / UP), URL, downtime duration, link to BetterStack incident. BetterStack's default Slack template covers all of this; no custom payload work needed.
- **Mute rules:** Slack channel notifications set to "every message, including @channel" with mobile push enabled. Crucially: do **not** put this channel in a "mute during business hours" rule — schools live during business hours.

### 2. Email (secondary)

- **To:** noahsundberg@gmail.com (primary), support@pickuproster.com (secondary, BCC).
- **Setup:** BetterStack > Notification Settings > add both addresses as targets, attach to the same alert policy as the Slack webhook.
- **Subject template:** `[ALERT] {monitor.name} is DOWN (since {incident.start})` — BetterStack supports template variables; keep it short so it's readable on a phone notification preview.
- **`support@pickuproster.com` BCC** ensures support-volunteer eyes on the inbox see the alert too, even if Noah is unreachable. The runbook's escalation tree already calls out support email as T+10.

### 3. Phone call (tertiary, free-tier-limited)

- BetterStack free tier includes a small monthly count of phone calls. Reserve them for the *worst-case escalation*: monitor still DOWN after 10 minutes of un-acknowledged alerts.
- **Setup:** add Noah's phone number as a "call escalation" step in the alert policy with a 10-minute delay after initial Slack/email page.
- **Why not first:** burn rate. The free-tier call budget will run out in one bad week if every brief 5xx blip pages by phone.

### Acknowledge + auto-resolve behaviour

- BetterStack auto-resolves an incident when the next probe succeeds. Document this in `docs/ops-runbook.md` so a 30-second blip doesn't turn into a "what was that?" thread.
- Acknowledge from Slack (`/acknowledge` BetterStack slash command after first webhook setup, or the inline button in the Slack message) — this stops further escalation but keeps the incident open for post-mortem.

### `docs/incidents/` integration

The very first alert that fires should walk the team through creating `docs/incidents/2026-MM-DD-<slug>.md`. Add a one-line "what to do next" footer to the BetterStack Slack template:

> When resolved → write `docs/incidents/YYYY-MM-DD-<slug>.md` per ops-runbook § "Post-incident"

(BetterStack supports Markdown in custom Slack templates; one-line footer is enough.)

## File list

This workstream is mostly an out-of-repo configuration pass (BetterStack account, Slack webhook). The repo touches are small and optional from this spec's standpoint:

### To create

- `docs/nightly-specs/2026-04-28-uptime-monitor.md` — **this file** (created).
- `docs/uptime-monitor.md` (optional, post-buy) — record of the chosen vendor + monitor list + alert routing, so a future Noah-or-agent can rebuild the monitor account from scratch without re-reading this research doc. Lives next to `docs/ops-runbook.md`. Contents: one paragraph "we use BetterStack because…", the monitor table from above (kept in sync as monitors are added), and the Slack/email targets. **Recommended** but not in-scope to write tonight — Noah writes this after he creates the account, since he's the one who'll know which Slack workspace + webhook he ended up using.
- `docs/incidents/.gitkeep` (one-liner) — pre-create the directory the runbook references, so the first incident doesn't waste a minute on `mkdir`.

### To edit

- `docs/ops-runbook.md` § "Communication tree" item 3 — replace "see queue item 6 — once wired" with a concrete pointer to BetterStack + the Slack channel name. **One-line edit; can be in the same commit that ships this spec, or in the follow-up commit Noah writes after the account is up.**
- `docs/nightly-queue.md` — flip item #6 from `[ ]` to `[x]` after Noah creates the account and confirms the first synthetic alert fires end-to-end. **Not** in this commit (queue scope says "Actual account signup is a Noah-action").

### To not touch

- `app/routes/api/healthz.ts` — already does the right thing. Resist the urge to add a `?check=db` mode now; if we need a deeper health probe, a separate `/api/healthz/deep` route is the cleaner pattern, and that's a different ticket.
- `app/domain/status/components.ts` — internal status page is independent of external monitoring. The two probe sets stay synchronized in expected substring (e.g., the marketing-hero string appears in both the internal probe and BetterStack monitor #1) but the registries don't share code.
- `wrangler.jsonc` — no env vars or bindings needed; BetterStack does not call into the Worker.

## Testing approach

External monitoring is by definition out-of-band; nothing is unit-test-able in this repo. Verification is a one-time manual exercise after Noah creates the BetterStack account:

1. **First-probe success.** Add monitor #2 (`/api/healthz`) first, watch the BetterStack dashboard turn green within 3 min. Confirms the account is wired and probing the right URL.
2. **Synthetic outage check.** Briefly point monitor #2 at `https://pickuproster.com/api/this-route-does-not-exist` (404). Watch:
   - Slack `#alerts-pickuproster` receives a message inside ~6 min (3 min for first failed probe + ~3 min for confirmation depending on BetterStack's flap-prevention).
   - Email arrives at noahsundberg@gmail.com inside the same window.
   - BetterStack dashboard shows the incident as DOWN.

   Then revert the URL, watch the auto-recover. Total exercise ~15 min.
3. **Acknowledge flow.** Trigger another synthetic failure, acknowledge from the Slack inline button, watch escalation stop. Confirms the phone-call escalation won't trigger during a known-bad change window.
4. **Per-monitor accuracy spot-check (one-off).** For each of the 7 monitors, hit the URL with `curl` and confirm the keyword the monitor checks for is actually present:

   ```bash
   curl -s https://pickuproster.com/ | grep -F 'Pickup Roster' && echo OK
   curl -s https://pickuproster.com/api/healthz | grep -F '"ok":true' && echo OK
   curl -s https://pickuproster.com/login | grep -F 'Sign in' && echo OK
   curl -s https://pickuproster.com/status | grep -F 'Status' && echo OK
   curl -s https://staging.pickuproster.com/api/healthz | grep -F '"env":"staging"' && echo OK
   curl -s https://school-organizer.sundbergne.workers.dev/api/healthz | grep -F '"ok":true' && echo OK
   curl -s https://demo.pickuproster.com/ | grep -F 'Pickup Roster' && echo OK
   ```

   Catches a stale keyword (e.g., the marketing copy changing without the monitor following) before the monitor false-positives in production.
5. **No verification needed for the "what if we lose the Cloudflare zone" path.** That's the very failure mode the external monitor is here to catch; we cannot test it without breaking prod. The production-recovery path is "watch BetterStack page Noah" — and the only way to verify that for real is the next real incident.

### Standing-pattern check the next polish agent should verify

Once the monitor exists, every new public route added to the app should be evaluated for "should this be in the uptime monitor?" Add a one-line note to `docs/ops-runbook.md` § "Pre-deploy checklist" so the question gets asked. (Most new routes won't qualify; the bar is "would a parent or admin notice if it 500'd at 3 PM?")

## Open questions

1. **Demo tenant timing.** Monitor #7 (`https://demo.pickuproster.com/`) presumes queue item #7 (`demo-sandbox`) has shipped. If Noah creates the BetterStack account before #7 lands, point #7 at a real pilot tenant subdomain instead, and either move the monitor or replace the URL when `demo-sandbox` ships. Recommendation: **swap, don't wait** — a real-tenant probe is at least as informative as a demo-tenant probe, and waiting for #7 is waiting indefinitely.
2. **Slack channel naming.** `#alerts-pickuproster` is the recommended name (matches the convention many teams use); Noah may already have a generic `#alerts` channel that would consolidate signal. Either is fine — the spec doesn't depend on the name. Default to `#alerts-pickuproster` for forward-compatibility with future per-product alerting.
3. **Public status page (BetterStack Team feature).** Free tier doesn't include a hosted status page on a custom domain. Until we upgrade, the internal `/status` page IS our status page; the external monitor exists to alert *us*, not the public. Pin the upgrade trigger to "first pilot conversation that asks where the public status page lives." That'll come; it's the standard B2B-SaaS sales-cycle question.
4. **Sentry alert deduplication.** Sentry can also fire on a 5xx burst in the Worker. Noah will get two pages for the same outage (Sentry + BetterStack) until we route Sentry alerts to the same Slack channel, where BetterStack's "this is the actual outage" message visually dominates. Recommendation: route Sentry alerts to `#alerts-pickuproster` too. Owners: BetterStack stays the primary because Sentry alerts go silent in the *exact* failure mode (full Worker outage) we care about; Sentry is the secondary "something is going wrong, but the Worker can still report it."
5. **Cronitor for cron monitoring (deferred).** The `*/2 * * * *` status-probe cron + `0 10 * * *` billing cron are exactly what Cronitor does best. Adding Cronitor (free tier, 5 monitors fits both crons + 3 spares) once BetterStack is up is a follow-up worth queueing, but separate from this workstream — the failure modes are different (a cron skip is silent; a Worker outage is the whole site). Flagged here so the next polish agent picks it up.
6. **Multi-region probes (deferred).** BetterStack free tier probes from one region. When a "the site's down for parents in Texas but not California" incident actually happens, upgrade to multi-region. Until then, single-region detection covers the >95% case.

## Summary line for the queue

> nightly-research 2026-04-28 #6: pick **BetterStack free tier** (10 monitors, 3-min interval, free phone/SMS, Slack + email + webhook integrations, hosted off Cloudflare). Pre-draft 7 monitors (apex, healthz, login, status, staging healthz, workers.dev healthz, demo tenant) with keyword-match assertions, three-channel alert routing (Slack `#alerts-pickuproster` primary, noahsundberg@gmail.com + support@ secondary, phone call after 10 min un-acknowledged). Account creation is a Noah-action; runbook integration is a one-line edit after the first synthetic alert fires green.
