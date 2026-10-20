# Pickup Roster

Pickup Roster is a multi-tenant school operations app: homerooms, car line / bingo board, viewer access, and billing (Stripe). Built with **React Router 7**, deployed to **Cloudflare Workers** with **D1** (SQLite) and **Prisma 7**.

## Requirements

- Node.js 20+
- npm

## Local development

Install dependencies (generates the Prisma client):

```sh
npm install
```

### Fast UI + SQLite (no Worker)

Uses the Vite alias to `app/db.local.server.ts` and a local SQLite file (`DATABASE_URL`, default `file:./dev.db`):

```sh
npm run dev
```

### Full Cloudflare stack (D1 + Durable Objects)

Matches production: build the app, then run the Worker:

```sh
npm run dev:worker
```

Copy `.dev.vars.example` to `.dev.vars` and set secrets (e.g. `BETTER_AUTH_SECRET`). See [Cloudflare](#cloudflare) below.

## Multi-tenant Prisma

Tenant isolation is enforced with a Prisma client extension (`orgId` on all school-scoped models) and host-based org resolution. Details: [`docs/multi-tenant-prisma-extension.md`](docs/multi-tenant-prisma-extension.md).

### Marketing site vs school subdomains

Configure these Worker vars (see [`wrangler.jsonc`](wrangler.jsonc) and [`env.d.ts`](env.d.ts)):

- **`PUBLIC_ROOT_DOMAIN`** — e.g. `pickuproster.com`. The apex host and `www` serve the marketing pages (`/`, `/pricing`, `/faqs`, `/signup`). Tenant hosts are `{orgSlug}.PUBLIC_ROOT_DOMAIN`, resolved to `Org.slug`.
- **`MARKETING_HOSTS`** — comma-separated hosts that always behave as marketing (default includes `localhost` and `127.0.0.1` for local dev).
- **`PLATFORM_ADMIN_EMAILS`** — comma-separated emails that may access `/platform` (internal org list) in addition to users with role `PLATFORM_ADMIN`.
- **`ANTHROPIC_MODEL`** — Messages API model for the help chat. Defaults to `claude-haiku-5-5`.
- **`SUPPORT_NOTIFY_EMAIL`** — inbox for new support tickets. Defaults to `NoahSundberg@gmail.com`.

The help chat also needs the Worker secret `ANTHROPIC_API_KEY` (`npx wrangler secret put ANTHROPIC_API_KEY`). Do not commit a key. Staff replies reuse `RESEND_API_KEY` and the email queue. See [docs/deploy.md](docs/deploy.md).

Self-serve signups start a **30-calendar-day** trial with no card (`trialEndsAt` at signup; the daily cron suspends the org when it passes). The qualifying-pickup-day extension applies only to `FREE` plans (see `app/domain/billing/trial.server.ts`). A **scheduled cron** in `wrangler.jsonc` runs trial maintenance daily.

## Cloudflare

### One-time

1. [Install Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and log in: `npx wrangler login`.
2. Ensure the D1 database in `wrangler.jsonc` exists in your account (or create one and update `database_id` / `database_name`).

### Deploy

Production ships from GitHub Actions when a version tag is pushed. Staging ships on every push to `master`. Both jobs apply pending D1 migrations before `wrangler deploy`, and a failed migration stops the deploy. See [docs/deploy.md](docs/deploy.md) for the tag command, the Cloudflare API token permissions, and how SQL in `migrations/` is created (`wrangler d1 migrations create`, not Prisma Migrate).

### Post-deploy

- Set production secrets in the Cloudflare dashboard (Workers → your worker → Settings → Variables) or via `wrangler secret put`, e.g. `BETTER_AUTH_SECRET`.
- Configure any R2 buckets or custom domains referenced in `wrangler.jsonc` / `env.d.ts`.

### Stripe

See [docs/stripe-products.md](docs/stripe-products.md) for product/price setup. Create the four Prices (Car Line $150/month and $1,440/year, Campus $500/month and $4,800/year) with `npm run stripe:create-prices`, then set the secrets it prints:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_CAR_LINE_PRICE_ID
npx wrangler secret put STRIPE_CAR_LINE_ANNUAL_PRICE_ID
npx wrangler secret put STRIPE_CAMPUS_PRICE_ID
npx wrangler secret put STRIPE_CAMPUS_ANNUAL_PRICE_ID
```

Point your Stripe webhook endpoint at `https://pickuproster.com/api/webhooks/stripe` and subscribe to at least `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `invoice.payment_succeeded`, and `invoice.payment_failed`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | React Router dev server (local DB) |
| `npm run dev:worker` | Build + `wrangler dev` (D1 + DO) |
| `npm run build` | Prisma generate + production build |
| `npm run deploy` | Build + deploy the production Worker from a laptop (does not apply migrations; releases use a `v*` tag, see [docs/deploy.md](docs/deploy.md)) |
| `npm run d1:migrate` | Apply D1 migrations to the remote production DB |
| `npm run test` | Domain tests |

## Running E2E tests

Install the Chromium browser binary once:

```sh
npx playwright install chromium
```

Then run the full suite against a local wrangler dev server:

```sh
npm run test:e2e
```

The dev server (`npx wrangler dev --log-level=warn`) is started automatically by Playwright before the tests run. Use `npm run test:e2e:ui` for the interactive Playwright UI mode.

## Docs

- [Multi-tenant Prisma (extension + wiring)](docs/multi-tenant-prisma-extension.md)
