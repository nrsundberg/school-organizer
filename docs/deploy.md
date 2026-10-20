# Deploying Pickup Roster

Production deploys run in GitHub Actions when a version tag is pushed. The workflow is `.github/workflows/deploy.yml`.

## Release

1. Merge to `master`. That push deploys **staging**: pending migrations on `school-organizer-staging`, then `wrangler deploy --env staging`.
2. Tag the commit you want in production and push the tag:

   ```sh
   git checkout master
   git pull
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. Actions checks out that tag, uses Node 22, runs `npm ci`, typecheck, and unit tests, applies pending migrations to the production D1 database `school-organizer` (binding `D1_DATABASE`), then runs `npm run build && npx wrangler deploy --env production`.

Pushing the tag is the deploy. The same production job can be started from the Actions tab (**Run workflow**). Two production deploys cannot run at the same time.

If the migration step fails, the job stops and the Worker is not deployed. Wrangler only applies migrations that are not already recorded, so a release with no new SQL still succeeds.

`npm run deploy` on a laptop does **not** apply migrations. Use the tag.

## Migrations

D1 SQL lives in `migrations/` and is applied by Wrangler (`migrations_dir` in `wrangler.jsonc`). Create the next file with:

```sh
npm run d1:create-migration <name>
```

That is `wrangler d1 migrations create`. Edit the generated SQL and commit it. This repo does not generate that SQL with `prisma migrate diff`. `prisma/migrations/` is not the D1 history.

Migrations run **before** the new Worker is published, while the previous version is still serving traffic. Each migration has to be safe for that older code: add columns and tables in this release, and drop or rename them only in a later release after the old Worker is gone.

A pull request that changes `migrations/` runs `.github/workflows/migrations.yml`, which applies the whole history to a fresh local D1 (`wrangler d1 migrations apply school-organizer --local`). That check does not touch production or staging.

## GitHub secrets and environments

Create two [GitHub Environments](https://github.com/nrsundberg/school-organizer/settings/environments): `production` and `staging`. The production job will not start until the `production` environment exists. Add required reviewers there if a tag push should wait for approval.

Secrets, on the repository or on those environments (environment secrets override repository secrets for that job):

| Secret | Required | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | yes | API token below |
| `CLOUDFLARE_ACCOUNT_ID` | no | `a7f63e2108d01fc6d8571772ac20f3e9` is the default when this secret is unset |

### Cloudflare API token

Account `a7f63e2108d01fc6d8571772ac20f3e9`:

- **Workers Scripts: Edit** — publish the Worker. Durable Object migrations in `wrangler.jsonc` ship with the script; there is no separate Durable Objects token scope.
- **D1: Edit** — databases `school-organizer` and `school-organizer-staging` (both use binding `D1_DATABASE`).
- **Workers R2 Storage: Edit** — buckets `pickup-roster-org-branding` and `pickup-roster-org-branding-staging` (binding `ORG_BRANDING_BUCKET`).
- **Queues: Edit** — `pickup-roster-email`, `pickup-roster-email-dlq`, `pickup-roster-email-staging`, and `pickup-roster-email-staging-dlq`.
- **Account Settings: Read**

Zone `pickuproster.com`:

- **Workers Routes: Edit** — apex, `www`, `*.pickuproster.com`, and the staging hostnames in `wrangler.jsonc`.
- **Zone: Read**
- **DNS: Edit** — the `custom_domain: true` routes can create or update proxied DNS records on this zone.

User:

- **User Details: Read**
- **Memberships: Read**

Wrangler uses the user scopes to resolve the account. Rate-limit bindings are part of the Worker publish (Workers Scripts: Edit), not a separate product permission.

## Help chat and support inbox

The help bubble calls Anthropic from the Worker. The key is a secret, not a var in `wrangler.jsonc` (this repo is public).

```sh
npx wrangler secret put ANTHROPIC_API_KEY --env staging
npx wrangler secret put ANTHROPIC_API_KEY --env production
```

`ANTHROPIC_MODEL` is a plain var and defaults to `claude-haiku-5-5`. Change it in `wrangler.jsonc` if you want a different Messages API model id. Paste the key alone: quotes, a `Bearer ` prefix, or an `x-api-key:` label make Anthropic return 401. Set `HELP_CHAT_ENABLED` to `0` to turn the model off without removing the secret. The contact form stays up.

The first chat message, `/contact`, and `/api/help/ticket` require the existing Turnstile widget (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES`). The widget should be Managed. The chat uses `appearance: interaction-only` and action `help_chat`; the contact form uses `contact`; ticket posts use `help_ticket`. After a valid token the chat returns an HMAC grant (signed with `BETTER_AUTH_SECRET`) that lasts 30 minutes, then the visitor is challenged again. Siteverify checks the action and that the token hostname is the request host. Add every host the bubble runs on (apex, `www`, workers.dev, and tenant subdomains) to the Turnstile widget's hostname list in the Cloudflare dashboard, or the widget will not issue a token there.

New tickets email `SUPPORT_NOTIFY_EMAIL` (default `NoahSundberg@gmail.com`). Staff replies use the existing Resend queue (`RESEND_API_KEY` plus the `EMAIL_QUEUE` binding). Set `RESEND_API_KEY` with `wrangler secret put` if it is not already on the Worker.

Support tables ship in `migrations/0045_support_tickets.sql`. Daily chat counters ship in `migrations/0046_help_chat_quota.sql`. The tag deploy applies those migrations before the new Worker goes out. A laptop `npm run deploy` does not.

`staging.pickuproster.com/*` is a zone route on the staging Worker, next to the custom domain. Production's `*.pickuproster.com/*` route matches that host and takes precedence over a custom domain, so the apex was served by production until the more specific route existed. Publishing routes needs **Zone → Workers Routes → Write** on `pickuproster.com` for the GitHub `CLOUDFLARE_API_TOKEN`. Script upload succeeds with Workers Editor alone, which is why staging deploys fail at the routes step while workers.dev still updates.

Local `npm run dev` uses the LibSQL file (`file:./dev.db`), not D1. Apply the Prisma schema there with `npx prisma db push` before trying the contact form or the inbox. Put `ANTHROPIC_API_KEY` in the environment (or `.dev.vars` for `npm run dev:worker`). Without the key the bubble still opens and the contact form still saves tickets. Turnstile is skipped when `TURNSTILE_SECRET_KEY` is unset and `ENVIRONMENT` is not `staging` or `production`.
