# Pickup Roster — Operational Runbook

**Audience:** on-call engineer (currently: Noah). Keep this open during any
dismissal-time incident. The companion front-desk one-pager for school
admins is `docs/dismissal-day-checklist.md`.

**Default on-call:** noahsundberg@gmail.com (also the sole entry in
`PLATFORM_ADMIN_EMAILS` in `wrangler.jsonc`).

**Support inbox:** support@pickuproster.com (`SUPPORT_EMAIL` in
`wrangler.jsonc`).

---

## The two numbers that matter

1. **Dismissal windows are non-negotiable.** A 30-minute outage at 3:00pm
   is a P0, no matter how few tenants are affected. Every other kind of
   outage downgrades accordingly.
2. **Mean-time-to-paper < 90 seconds.** Every admin in a pilot tenant has
   a printed master list from `/admin/print/master` as the documented
   fallback. If the app is unreachable for ~90 seconds during dismissal,
   the school switches to paper and we catch up afterwards. See the
   front-desk checklist.

---

## Pre-deploy checklist

Run through this before any deploy that is NOT an autonomous agent merge
that already ran the nightly gate (typecheck + tests + staging smoke).

1. `git status` clean on `master`, and `git log origin/master..HEAD` shows
   nothing you didn't mean to ship.
2. `npm run typecheck` green.
3. `npm test` green (unit suites listed in `package.json` → `scripts.test`).
4. If there are new migrations (`ls migrations/`): stage them first.

   ```bash
   npm run d1:migrate:staging          # applies to school-organizer-staging
   npm run deploy:staging              # deploys branch to staging
   ```

   Then smoke the staging URL manually:

   - `https://staging.pickuproster.com/` (marketing)
   - `https://staging.pickuproster.com/healthz`
     → `{ "ok": true, "env": "staging" }`
   - `https://{slug}.staging.pickuproster.com/` for a seeded tenant — this
     is the host that exercises the same cross-subdomain auth + tenant
     routing code paths as production.
   - `npx playwright test e2e/smoke.spec.ts --config=playwright.staging.config.ts`

5. **Dismissal-window rule.** Do not deploy between 2:30pm and 4:00pm in
   the timezone of any active pilot tenant. The scheduled agents already
   run at night; a human push during that window needs a written reason.
6. Run prod migrations if any:

   ```bash
   npm run d1:migrate     # applies to school-organizer (prod)
   ```

7. Deploy:

   ```bash
   npm run deploy
   ```

8. Post-deploy: hit `/healthz` on prod, watch Sentry for 2 minutes, eyeball
   the board on a real tenant. Stay on-call for 30 minutes.

---

## Rollback — the single most important procedure

Cloudflare Workers keeps prior deployments and can flip back in seconds.

```bash
# 1. See the deployments. Most recent at top; yours is probably the first row.
wrangler deployments list

# 2. Roll back to the previous deployment ID.
wrangler rollback <deployment-id> --message "rollback: <short reason>"

# 3. Verify.
curl -s https://pickuproster.com/healthz | jq
```

Rules of thumb:

- **If the incident started within 10 minutes of a deploy, rollback first,
  investigate second.** You can always redeploy once the bug is fixed.
- **Rollback is safe for Worker code changes.** It is NOT safe if the
  rolled-back version expects a different D1 schema than what's live.
  Check `migrations/` for anything applied in the same window — if you
  rolled back across a migration, the forward-only schema will stay; the
  old code either tolerates the extra columns (fine) or crashes on a
  missing-table/column error (rare; you'll see it in Sentry immediately).
  If the rolled-back version crashes, the next step is reverting the
  migration manually, which is a 30-minute job — skip to the failover
  below instead.
- **Failover while you figure it out.** See "Force-failover to paper"
  below. Schools don't wait for your post-mortem.

### Forcing a known-good version

If `rollback` itself misbehaves, redeploy the known-good commit directly:

```bash
git checkout <known-good-sha>
npm ci
npm run deploy
git checkout master   # leave your checkout in the expected state
```

---

## Force-failover to paper (print master list)

Every tenant admin can print a pre-built roster — one page per spot, with
student names, space numbers, and homerooms — at:

```
https://<tenant-slug>.pickuproster.com/admin/print/master
```

The route is at `app/routes/admin/print.master.tsx`. It requires an ADMIN
role session cookie. In an outage where the admin cannot load any app
page, the admin uses the **printed copy they made at the start of the
week** (the dismissal-day checklist requires this). That printed copy is
the actual failover — not a live fetch during the outage.

If admins have NOT been running the Monday-print drill:

- Tell them over the phone to read names off the paper list they already
  have for fire drills (the `/admin/print/homeroom/:teacherId` export is
  the teacher-side equivalent).
- Post-incident: add the Monday-print drill to their onboarding and
  update `docs/dismissal-day-checklist.md` to reflect whatever gap this
  incident surfaced.

**Status-page tip.** If Stripe or Resend is down, the board still works —
those are only checkout and email. `STRIPE_STATUS_URL` in `wrangler.jsonc`
points at Stripe's live feed; a 2-minute cron (`runStatusProbes` in
`workers/app.ts`) polls it so we can correlate from Sentry.

---

## On-call escalation

The tenant raises an incident via:

1. **Support inbox:** support@pickuproster.com → goes to
   noahsundberg@gmail.com. Forwarded by `app/routes/contact.tsx` once that
   ships (queue item 3).
2. **Phone (pilot tenants only):** Noah's direct line, shared during
   pilot signup.
3. **Uptime monitor alerts:** see queue item 6 — once wired, alerts
   email noahsundberg@gmail.com + page a Slack webhook.

Escalation tree until a second engineer is hired:

1. **T0 (0–5 min):** Noah triages. `wrangler deployments list`,
   Cloudflare dashboard (Workers → Analytics), Sentry issues feed. If
   the cause isn't obvious in 5 minutes, rollback and keep looking in
   staging.
2. **T+10:** If still unresolved, tell each affected tenant over email or
   phone: "Switch to paper, we'll catch up after pickup." Note the
   timestamp for the post-mortem.
3. **T+30:** Post an incident note under `docs/incidents/YYYY-MM-DD.md`
   (create that folder on first incident) with start/end timestamps,
   affected tenants, rollback SHA, root cause (even "unknown, still
   investigating"), and followups.

---

## Critical metrics to watch

| Signal | Where | Healthy | Alarm |
|---|---|---|---|
| `/healthz` | `curl https://pickuproster.com/healthz` | 2xx within 300ms, body `{ ok: true }` | non-2xx, >2s, or body `ok: false` |
| Worker error rate | Cloudflare → Workers → `school-organizer` → Analytics | < 1% | spike above baseline for > 2 min during dismissal window |
| Sentry issues | sentry.io project dashboard | new-issue rate baseline | any new "spike" event during dismissal window |
| Durable Object count (BINGO_BOARD) | Cloudflare → Workers → DO → `BingoBoardDO` | ≈ one per active tenant during dismissal | count flat at 0 during a dismissal window = websocket server down |
| D1 query p95 | Cloudflare → D1 → `school-organizer` → Metrics | < 50ms for roster reads | > 500ms sustained |
| Email queue depth | Cloudflare → Queues → `pickup-roster-email` | drains within 1 minute | backlog > 100 or DLQ non-empty |
| Stripe status cron | logs from `runStatusProbes` every 2 min | last run < 5 min old | no log entry > 10 min |
| Billing cron | logs from daily 10:00 UTC run | runs at 10:00 UTC and exits cleanly | missing or non-zero exit |

---

## Known runbook-worthy incidents

### "The board stopped updating" (websocket is dead)

Symptoms: admins can load `/admin` fine, but the live board isn't updating
when controllers activate spaces. Students sit piled up at the top.

Checks:

1. Browser devtools → Network → WS. Is `/ws` open? If closed, the Durable
   Object probably crashed.
2. Cloudflare → Workers → DO → `BingoBoardDO` → logs.
3. If the DO logs show a crash loop, rollback (see above) is the fastest
   fix. The DO restarts on the next connection after redeploy.

Fallback while the fix is in flight: admins use `/admin` + manual refresh,
or switch to the paper list.

### "Stripe webhook events are failing"

Symptoms: a signup seems to hang on the "Returning from checkout…" page,
or a trial shows as unpaid despite a successful charge.

Checks:

1. Stripe dashboard → Developers → Webhooks → `pickuproster.com/api/webhooks/stripe`
   → recent deliveries.
2. If Stripe shows 4xx/5xx responses from us, pull the Worker log via
   `wrangler tail` and look for the failing handler.
3. Stripe retries for 3 days, so a 10-minute outage is survivable. The
   user's trial will settle itself on the next webhook delivery.

### "A tenant's board is 500ing"

Symptoms: a single tenant slug serves 500 but other tenants and the
marketing host load fine.

Checks:

1. `wrangler tail --env production` and have the admin reload. Look at
   the error.
2. Most common cause is a row they just created that violates an implicit
   assumption (nullable spaceNumber, empty homeRoom). Check Sentry for
   the stack trace.
3. If it's blocking dismissal, rollback; then fix-forward afterwards.

---

## Deployment topology quick reference

Everything below is already in `wrangler.jsonc`. This section is here so a
2:45pm you doesn't have to go re-read it.

- **Hosts:**
  - `pickuproster.com` and `www.pickuproster.com` → marketing (custom
    domain routes).
  - `*.pickuproster.com` → tenant boards (zone route).
  - `staging.pickuproster.com` → staging marketing (custom domain).
  - `*.staging.pickuproster.com` → staging tenant boards (zone route).
  - `school-organizer-staging.sundbergne.workers.dev` → staging fallback
    (workers.dev URL kept as a backup deploy target; cross-subdomain
    sessions don't persist on this host — use the canonical apex).
- **D1:**
  - Production: `school-organizer` (binding `D1_DATABASE`).
  - Staging: `school-organizer-staging`.
- **R2 (branding assets):**
  - Production: `pickup-roster-org-branding`.
  - Staging: `pickup-roster-org-branding-staging`.
- **Queues (outbound email via Resend):**
  - Production: `pickup-roster-email` + `pickup-roster-email-dlq`.
  - Staging: `pickup-roster-email-staging` + `...-staging-dlq`.
- **Durable Object:** `BingoBoardDO` (binding `BINGO_BOARD`, class in
  `workers/app.ts`).
- **Rate limiters:** `RL_AUTH` (10/60s, auth endpoints), `RL_BILLING`
  (20/60s, Stripe endpoints).
- **Crons:**
  - `0 10 * * *` — daily billing / trial maintenance.
  - `*/2 * * * *` — status probes.
- **Key env vars:** `SENTRY_DSN`, `SUPPORT_EMAIL`, `PUBLIC_ROOT_DOMAIN`,
  `MARKETING_HOSTS`, `PLATFORM_ADMIN_EMAILS`, `STRIPE_STATUS_URL`,
  `DISABLE_CROSS_SUBDOMAIN_COOKIES` (kill switch — set truthy to fall
  back to host-only cookies without redeploying).

---

## DNS setup (one-time, per environment)

The `pickuproster.com` zone in Cloudflare must have these proxied DNS
records for the Worker routes in `wrangler.jsonc` to resolve. Any
zone migration or tenancy change reconstructs the same set:

| Record | Type | Target | Proxied? | Purpose |
|---|---|---|---|---|
| `pickuproster.com` (apex) | A/AAAA or CNAME | (any — overridden by Worker route) | yes | Marketing apex |
| `www.pickuproster.com` | CNAME | `pickuproster.com` | yes | Marketing www |
| `*.pickuproster.com` | A/AAAA or CNAME | (any) | yes | Wildcard for prod tenants |
| `staging.pickuproster.com` | A/AAAA or CNAME | (any) | yes | Staging apex |
| `*.staging.pickuproster.com` | A/AAAA or CNAME | (any) | yes | Wildcard for staging tenants |

The actual A target doesn't matter — Cloudflare's proxy intercepts the
request and dispatches to the matching Worker route. Use the same
placeholder (e.g. `192.0.2.1`) the prod records use.

After adding records, deploy with `npm run deploy:staging` and verify
`https://staging.pickuproster.com/healthz` returns `{ ok: true, env: "staging" }`.
A 525/526 means the wildcard cert hasn't propagated yet — Cloudflare's
default Universal SSL covers `*.pickuproster.com` but not the
double-wildcard `*.staging.pickuproster.com`. Add an Advanced
Certificate covering `staging.pickuproster.com` and
`*.staging.pickuproster.com` if 5xx-cert errors persist after ~5 min.

---

## Contact tree

| Role | Who | How |
|---|---|---|
| Primary on-call | Noah Sundberg | noahsundberg@gmail.com; phone shared with pilots |
| Platform admin (app-level) | Noah Sundberg | `PLATFORM_ADMIN_EMAILS` in `wrangler.jsonc` |
| Support inbox | shared | support@pickuproster.com → Noah |
| Cloudflare account | Noah | CF dashboard account: sundbergne |
| DNS (pickuproster.com zone) | Noah | same CF account |
| Stripe | Noah | dashboard.stripe.com account linked to support@pickuproster.com |
| Resend (email) | Noah | resend.com account; API key in CF secrets |
| Sentry | Noah | project `school-organizer` |

When the team grows, replace this table with a real paging setup — see
queue item 6 (`uptime-monitor`) for the first step toward that.

---

## Post-incident

1. Every incident gets a markdown file under `docs/incidents/YYYY-MM-DD-<slug>.md`.
2. Template fields: start / detected / mitigated / resolved timestamps,
   affected tenants, user-visible symptoms, root cause, action items.
3. Action items become queue entries (build or research) in
   `docs/nightly-queue.md` so they actually ship.
4. If the incident was dismissal-window, email the affected tenant admin
   the same day with what happened and what we changed. Schools forgive
   outages that get a real explanation; they don't forgive silence.
