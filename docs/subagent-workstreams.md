# Multi-tenant parallel workstreams

Use these tracks to run implementation in parallel with minimal overlap.

**Current architecture (implemented):** marketing hosts (`PUBLIC_ROOT_DOMAIN` apex + `www`, plus `MARKETING_HOSTS`) serve landing/pricing/FAQs/signup without a tenant org. Tenant subdomains `{slug}.PUBLIC_ROOT_DOMAIN` resolve `Org.slug`. Middleware allowlists public marketing paths and sends anonymous users on tenant hosts to viewer PIN flow. `/platform` is gated by `PLATFORM_ADMIN` role or `PLATFORM_ADMIN_EMAILS`. Trial fields on `Org` plus nightly cron (`workers/app.ts` `scheduled`) refresh qualifying pickup days and end trials.

## Track A: Tenant schema and migrations
- Add `Org` model and `orgId` fields/indexes on tenant-scoped tables.
- Create migration and data backfill strategy.
- Keep auth tables (`User`, `Session`, `Account`, `Verification`) unscoped.
- Deliverable: schema + migration + seed/backfill script.

## Track B: Tenant context and db scoping
- Add host-to-org resolver middleware and `orgContext`.
- Add Prisma tenant extension for read filters and write stamping.
- Update `getPrisma` callsites to scoped access in tenant routes.
- Deliverable: tenant-safe db access path with isolation tests.

## Track C: Signup + free plan + billing
- Build org signup flow (`slug`, org creation, free-plan enrollment).
- Wire Stripe customer/subscription creation and webhook sync.
- Enforce org status gates in middleware (`active`, `past_due`, etc).
- Deliverable: working onboarding flow with billing lifecycle handling.

## Track D: Tenant branding and uploads
- Build org branding settings (colors + logo upload).
- Store branding by org and apply at tenant runtime.
- Ensure upload keys are org-prefixed and validated.
- Deliverable: tenant-specific branded experience after signup.

## Integration order
1. A and B can run in parallel first.
2. C starts once core org model from A is merged.
3. D can start after org identity/context in B exists.
4. Final integration verifies end-to-end signup to branded tenant launch.

## Suggested sub-agent kickoff prompts
- "Implement Track A from docs/subagent-workstreams.md only. Avoid route/UI changes."
- "Implement Track B from docs/subagent-workstreams.md only. Add tests for isolation."
- "Implement Track C from docs/subagent-workstreams.md only. Use existing auth stack."
- "Implement Track D from docs/subagent-workstreams.md only. Keep UI scoped to org settings."
