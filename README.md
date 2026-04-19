# School organizer

Multi-tenant school operations app: homerooms, car line / bingo board, viewer access, and billing (Stripe). Built with **React Router 7**, deployed to **Cloudflare Workers** with **D1** (SQLite) and **Prisma 7**.

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

- **`PUBLIC_ROOT_DOMAIN`** — e.g. `schoolorganizer.com`. The apex host and `www` serve the marketing pages (`/`, `/pricing`, `/faqs`, `/signup`). Tenant hosts are `{orgSlug}.PUBLIC_ROOT_DOMAIN`, resolved to `Org.slug`.
- **`MARKETING_HOSTS`** — comma-separated hosts that always behave as marketing (default includes `localhost` and `127.0.0.1` for local dev).
- **`PLATFORM_ADMIN_EMAILS`** — comma-separated emails that may access `/platform` (internal org list) in addition to users with role `PLATFORM_ADMIN`.

Trial length follows calendar days and qualifying pickup days (see `app/domain/billing/trial.server.ts`). A **scheduled cron** in `wrangler.jsonc` runs trial maintenance daily.

## Cloudflare

### One-time

1. [Install Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and log in: `npx wrangler login`.
2. Ensure the D1 database in `wrangler.jsonc` exists in your account (or create one and update `database_id` / `database_name`).

### Apply D1 migrations (remote)

After schema changes under `migrations/`:

```sh
npm run d1:migrate
```

### Deploy

From a machine where Wrangler can authenticate (see [Wrangler auth](https://developers.cloudflare.com/workers/wrangler/commands/#login)):

```sh
npm run deploy
```

This runs `prisma generate`, builds the React Router server bundle and client assets, and publishes the Worker plus static assets.

In non-interactive environments (CI, some sandboxes), set `CLOUDFLARE_API_TOKEN` with a token that has Workers deploy permissions. Otherwise run `npx wrangler login` once locally.

### Post-deploy

- Set production secrets in the Cloudflare dashboard (Workers → your worker → Settings → Variables) or via `wrangler secret put`, e.g. `BETTER_AUTH_SECRET`.
- Configure any R2 buckets or custom domains referenced in `wrangler.jsonc` / `env.d.ts`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | React Router dev server (local DB) |
| `npm run dev:worker` | Build + `wrangler dev` (D1 + DO) |
| `npm run build` | Prisma generate + production build |
| `npm run deploy` | Build + deploy to Cloudflare |
| `npm run d1:migrate` | Apply D1 migrations to remote DB |
| `npm run test` | Domain tests |

## Docs

- [Multi-tenant Prisma (extension + wiring)](docs/multi-tenant-prisma-extension.md)
