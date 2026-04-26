# Demo tenants — pending rollout

The demo-tenants seeder (Tasks 1–11 of [the plan](superpowers/plans/2026-04-25-demo-tenants.md)) has landed and is verified locally. The remaining three tasks are operational — they need to be run by you, with environment access, and were intentionally not automated.

Pick this back up when you're ready to record Loom videos or set up live demos.

---

## Task 12 — Local UI smoke test

Before pushing to staging, click through the demo data in a real browser to confirm everything looks the way you'd want for a recording.

```sh
npm run dev:worker          # start full Cloudflare-stack server on :8787
DEMO_PASSWORD_SEED=<your-shared-secret> npm run demo:seed:local
```

The seed prints credentials at the end. Save them somewhere you'll remember — they aren't stored anywhere else.

Then visit `http://bhs-example.localhost:8787` and log in as `admin@bhs-example.demo`.

Spot-check:
- **Tenant board** — car-line spaces 1..36 with some students pre-positioned (cars on the board on first render).
- `/admin/dashboard` — roster counts: 120 students, 12 classrooms, ~80 households.
- `/admin/drills` — 5 templates (Fire, Lockdown, Secure, Severe Weather, Reunification). "Recent runs" shows 2 ENDED runs from 14 and 28 days ago — open one and confirm ~80% of toggles are filled.
- `/admin/history` — ~220 historical car-pickup events spread across the last 21 days.
- `/admin/households` — sibling families have 2+ students.
- `/admin/dismissal-day-checklist` (or whatever the route ends up being) — 3 dismissal exceptions, mix of WEEKLY and DATE.
- Homepage banner — should show 1 program cancellation for ~2 days from now.

Repeat against `lincoln-example` (CAMPUS tier — bigger numbers) and one of the `westside-*-example` orgs (district trio). If anything looks off, re-run with `--target=local` after editing `scripts/demo-data/specs.ts`.

If the UI smoke is clean, proceed to Task 13.

---

## Task 13 — Apply to staging

```sh
# Confirm the staging D1 binding still matches wrangler.jsonc:
npx wrangler d1 list | grep school-organizer-staging
# Expect: database_id fc7bcf62-c40f-474e-9bec-64dfd0bd1135

# Set passwords (per-org overrides if you want stable creds across reseeds):
export DEMO_PASSWORD_SEED='<team secret>'
# or per-org:
export DEMO_PASSWORD_BHS='<strong>'
export DEMO_PASSWORD_LINCOLN='<strong>'
export DEMO_PASSWORD_WESTSIDE_ELEM='<strong>'
export DEMO_PASSWORD_WESTSIDE_MIDDLE='<strong>'
export DEMO_PASSWORD_WESTSIDE_HS='<strong>'

# Emit + apply in one shot:
npm run demo:seed:staging
```

Expected output: `✓ Wrote N bytes to demo-seed.staging.sql` followed by wrangler reporting success on each batch. Save the printed credentials.

Smoke-test login on staging — visit `https://bhs-example.<staging-host>` and sign in.

Clean up the emitted SQL: `rm demo-seed.staging.sql` (already gitignored, but tidy is good).

---

## Task 14 — Apply to production (deliberately two-step)

Confirm the prod D1 binding:

```sh
npx wrangler d1 list | grep -E 'school-organizer\b'
# Expect: database_id 35284987-f919-47e9-884d-d2f921324352
```

### Preflight: slug-collision check

`Org.slug` is `UNIQUE`. The seeder's wipe deletes by `orgId`, NOT by slug — so a real customer who somehow signed up with `lincoln-example` would not be cleared by the wipe, and the subsequent INSERT would fail. (The whole transaction rolls back, so no data damage — but you'd see a confusing error.)

Run this before applying:

```sh
npx wrangler d1 execute school-organizer --remote --command \
  "SELECT id, slug FROM Org WHERE slug IN ('bhs-example','lincoln-example','westside-elem-example','westside-middle-example','westside-hs-example') AND id NOT LIKE 'org_demo_%'"
```

If this returns any rows, rename the conflicting demo slug in `scripts/demo-data/specs.ts` (and bump its `randomSeed` so derived data stays deterministic) before proceeding.

### Step 1 — Emit and inspect

```sh
npm run demo:seed:prod:emit
# Writes demo-seed.prod.sql and prints credentials.
```

Open `demo-seed.prod.sql` and eyeball:
- Begins with `BEGIN;`, ends with `COMMIT;`
- Exactly **5** `INSERT INTO "Org"` lines, all slugs ending in `-example`
- No statement references a real-tenant id you recognize

### Step 2 — Apply

```sh
npx wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql
# Wrangler will prompt for confirmation since this writes prod — answer yes.
```

### Step 3 — Smoke

Visit `https://bhs-example.pickuproster.com`, log in with the printed admin credentials. Click through the same checks as Task 12.

### Step 4 — Cleanup

```sh
rm demo-seed.prod.sql
```

Save the credentials in 1Password (or wherever the team keeps shared creds). They are not stored anywhere else, and re-seeding does not regenerate them — running the seed again with the same `DEMO_PASSWORD_SEED` produces the same plaintext password (it's deterministic), so as long as you keep the seed value stable, the credentials stay valid across reseeds.

---

## Reminder: rerun cadence

The seed is idempotent. Re-run it any time you want fresher historical drill runs / call events (the 14- and 28-day offsets are computed from "now," and the 21-day call-event window slides). For Loom videos shot a month apart, re-seeding before each shoot gives you "yesterday/last-week"-flavored history without manual cleanup.

If you change roster sizes, brand colors, names, or anything else in `scripts/demo-data/specs.ts`, run `npm test` (the schema-apply smoke catches drift) and reseed each environment.

---

## Follow-ups (later, lower priority)

- **District aggregation.** When the in-flight district refactor lands, attach the three `westside-*-example` orgs to the new district entity. Hook: `districtKey: "westside"` already lives on the spec rows, so it's a one-line metadata add.
- **Lifecycle email guard.** Demo orgs are `ACTIVE` with no Stripe subscription. If/when the lifecycle email cron starts sweeping `ACTIVE` orgs, demos may receive emails. Either point demo admin emails at a sink mailbox or add `isComped = 1` to the seed and gate the cron on it.
- **Optional: UI badge for `-example` slugs.** A small "DEMO" pill on `/admin/*` would prevent any future viewer from confusing a demo screenshot with real data. Trivial to add when convenient.
