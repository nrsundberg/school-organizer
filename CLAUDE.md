# school-organizer / pickup-roster

Sandbox / Playwright / cleanup rules live in `~/.claude/CLAUDE.md` and apply
globally — read those first if you're new to this machine.

## Project quickref

- Stack: React Router 7 + Cloudflare Workers + Prisma + D1 + better-auth.
- Tests: `npm test` runs the Node `--test` suites (fast). `npm run test:e2e`
  runs Playwright; this is the disk-heavy one — the global rules apply.
  The repo has `npm run clean:e2e` and `npm run clean:tmp` for test-output
  and `/tmp` cruft — run those when you finish e2e work.
- Local dev: `npm run dev` (RR dev server) or `npm run dev:worker` (full
  Wrangler worker).
- Deploy: `npm run deploy` (prod) / `npm run deploy:staging`.
- Migrations: `npm run d1:create-migration <name>`, then
  `npm run d1:migrate` / `:staging`.
