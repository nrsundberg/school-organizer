# Demo tenants

This repo seeds five long-lived demo tenants for Loom recordings, marketing-page screenshots, and live demos:

| Slug                       | Plan     | Notes |
|----------------------------|----------|-------|
| `bhs-example`              | CAR_LINE | Mid-size single school. Default Loom subject. |
| `lincoln-example`          | CAMPUS   | Larger single school; advanced branding tier. |
| `westside-elem-example`    | DISTRICT | Sibling org #1 of the Westside district demo. |
| `westside-middle-example`  | DISTRICT | Sibling org #2. |
| `westside-hs-example`      | DISTRICT | Sibling org #3. |

The trio under `westside-*-example` is a placeholder for the in-flight district-aggregation work; today they are independent orgs with a shared brand palette.

## Running

The seeder is idempotent: every run wipes existing demo rows (matched by stable `org_demo_*` ids) and re-inserts.

### Local dev

```sh
npm run demo:seed:local
```

Defaults to `DATABASE_URL=file:./dev.db`. Pass `DATABASE_URL=...` to target a different libsql.

### Staging

```sh
npm run demo:seed:staging
```

Emits `demo-seed.staging.sql` then applies via `wrangler d1 execute --remote --env=staging`.

### Production

#### Preflight: confirm no slug collisions

`Org.slug` is `UNIQUE`. The wipe deletes by `orgId`, NOT by slug — so if a real customer has signed up under one of the demo slugs (e.g. some clever buyer claimed `lincoln-example`), the wipe will skip them and the subsequent INSERT will fail. Wrangler's `d1 execute --file` rolls the whole file back on failure (per its own message: "if the execution fails to complete, your DB will return to its original state and you can safely retry"), so no harm done — but you'll see a confusing UNIQUE error.

Before you apply, confirm none of the five demo slugs are taken:

```sh
wrangler d1 execute school-organizer --remote --command "SELECT id, slug FROM Org WHERE slug IN ('bhs-example','lincoln-example','westside-elem-example','westside-middle-example','westside-hs-example') AND id NOT LIKE 'org_demo_%'"
```

If this returns any rows, rename the conflicting demo slug in `scripts/demo-data/specs.ts` (and bump `randomSeed` so anything derived stays deterministic) before proceeding.

For safety the prod path is two-step:

```sh
npm run demo:seed:prod:emit                                                           # writes demo-seed.prod.sql
wrangler d1 execute school-organizer --remote --file=demo-seed.prod.sql               # apply (no --env flag)
```

Inspect `demo-seed.prod.sql` before applying. Look for: 5 `INSERT INTO "Org"` statements, expected slug suffixes (`-example`), and no rows referencing real-tenant ids.

### Wipe only

```sh
npm run demo:seed:wipe:local
```

Or for remote: re-emit with `--wipe-only` and apply.

## Credentials

Each org gets two users: an `admin@<slug>.demo` and a `controller@<slug>.demo`. Both share one password per org.

Password resolution order:
1. `DEMO_PASSWORD_<UPPER_SLUG_NO_SUFFIX>` (e.g. `DEMO_PASSWORD_BHS`, `DEMO_PASSWORD_WESTSIDE_ELEM`)
2. `DEMO_PASSWORD_DEFAULT`
3. Derived from `DEMO_PASSWORD_SEED` (sha256-truncated)

The script prints the resolved credentials at the end of every run. Save them out-of-band — they are not stored anywhere else.

The summary is the only place the plaintext is printed. Don't pipe the seed output to a log file or paste it into a ticket — the SQL files we emit only contain the PBKDF2 hash, but the terminal output reveals the plaintext. CI environments that log stdout are not safe to run this in unless redacted.

## Updating the seeded data

To change roster sizes, brand colors, names, etc.: edit `scripts/demo-data/specs.ts`. Run tests (`npm test`) and then re-seed each environment. Stable ids mean a re-seed cleanly replaces the old rows.

To add a new demo tenant: append to `DEMO_TENANTS` in `specs.ts`, give it a unique `orgId` and `randomSeed`, and re-seed.

## What gets seeded per org

- 1 `Org` row (with brand colors + plan)
- 1 `AppSettings` row (viewer PIN hashed; PIN = last 4 digits of `randomSeed`)
- 2 `User` rows (ADMIN + CONTROLLER) and matching credential `Account` rows
- N `Teacher` rows (homerooms named after `TEACHER_LAST_NAMES`)
- ~3× classrooms `Space` rows (car-line spaces)
- N `Household` rows
- N `Student` rows, ~30% with siblings
- 5 cloned `DrillTemplate` rows (fire, lockdown, secure, severe weather, reunification)
- 2 historical `DrillRun` rows (status = ENDED) for replay
- N `AfterSchoolProgram` rows
- 1 `ProgramCancellation` (next program day)
- 3 `DismissalException` rows (mix of DATE + WEEKLY)
- N past `CallEvent` rows spread across the trailing 21 days

## Cron + billing interactions

Demo orgs have `billingPlan` set but no Stripe subscription, no `trialStartedAt`, and `status='ACTIVE'`. The trial-expiry cron (`workers/app.ts`) keys off `OrgStatus = 'TRIALING'`, so demo orgs are not pulled into the trial pipeline. Same for billing webhooks — these orgs cannot be touched by any Stripe event because they have no `stripeCustomerId`.

If the lifecycle email cron (`SentEmail`) ever sweeps `ACTIVE` orgs, demo orgs may receive emails — set the admin email's mailbox to a sink you own, or add an `isComped = 1` flag in a future iteration.
