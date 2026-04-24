# Research spec — Priority 1 / support-contact

**Author:** polish agent (nightly run), 2026-04-24.
**Workstream:** Priority 1, item 3 in `docs/nightly-queue.md` (slug
`support-contact`).
**Status:** research only — no code changed in this run.

**Picked because:** tonight's build agent took P1 item #4
(`ops-runbook`) on branch `nightly-build/2026-04-24` (BLOCKED on the
staging wrangler-auth gate; docs-only diff). The next highest-priority
unblocked queue item without an existing research doc is #3
`support-contact`:

- #1 `roster-csv-import` — already has a thorough spec from
  2026-04-23-manual-1438 (`docs/nightly-specs/2026-04-23-manual-1438-roster-csv-import.md`).
- #2 `legal-pages` — `[!]` blocked pending Noah's inputs (legal entity
  name, state of incorporation, etc.).
- #3 `support-contact` — queued, no prior spec, unblocked. ← this run.
- 0d subtasks — partially in progress on a prior build branch and
  blocked on the seeded-tenant harness per tonight's build summary.

---

## Problem

The marketing site has no way for a prospect or existing pilot to
reach the team. The footer has a `mailto:support@pickuproster.com`
link and nothing else — no form, no acknowledgement state, no queue,
no audit trail. Leads evaporate because there's no capture surface
that a salesperson or on-call human can monitor without babysitting a
shared inbox. Support conversations from paying schools go to the
same address and sit next to cold outreach, which makes triage slow
at exactly the wrong moments (3pm on a dismissal day).

Per `docs/nightly-queue.md` item 3, we need a public contact form at
`/contact` that captures name, email, school, message, and topic;
hands the message to the existing email pipeline; surfaces a
success/failure state on the same page; and is linked from the
marketing nav and footer. Rate-limited to 1/IP/60s per the rate-limit
doc's "new binding per sensitive endpoint" pattern.

## Current state

### What exists today

- **Footer:** `app/components/Footer.tsx` (lines 49–53) renders a
  `mailto:${supportEmail}` link labeled "Support" and a `/faqs#status`
  link labeled "Status". No Contact link yet.
- **Marketing nav:** `app/components/marketing/MarketingNav.tsx`
  carries Pricing / Blog / FAQs. No Contact yet.
- **Support email resolver:** `app/lib/site.ts` exports
  `getSupportEmail(context)` which reads
  `context.cloudflare.env.SUPPORT_EMAIL`, falls back to
  `process.env.SUPPORT_EMAIL`, then to
  `DEFAULT_SUPPORT_EMAIL = "support@pickuproster.com"`. This is the
  address the form should send to (not hardcoded).
- **Root loader** already exposes `supportEmail` to the layout via
  `getSupportEmail(context)` (`app/root.tsx` line 169), so the
  contact page can pull it straight from
  `useRouteLoaderData("root")` or re-call the helper.

### Email pipeline

The app already has a fully-typed, queue-backed email pipeline:

- **Types** (`app/domain/email/types.ts`): discriminated union of
  `EmailMessage` with existing kinds `welcome`, `trial_expiring`,
  `mid_trial_checkin`, `password_reset`, plus a `probe` heartbeat.
  Adding a new kind requires: (a) a new `XxxMessage` shape, (b) a
  matching entry in the `SendableEmailMessage` union, (c) a renderer
  in `app/domain/email/templates/` and registered in
  `app/domain/email/templates/index.ts`'s exhaustive switch.
- **Enqueue:** `enqueueEmail(context, msg)` in
  `app/domain/email/queue.server.ts`. Non-throwing on a missing
  `EMAIL_QUEUE` binding (logs a warning) — request handlers can
  fire-and-forget without blocking a user response on a queue outage.
- **Send:** `sendEmail(env, msg)` in `send.server.ts` renders the
  template and hands off to Resend using `RESEND_API_KEY`.
- **Replies** route via the per-template `replyTo` field on
  `RenderedEmail`. Welcome template routes to
  `noahsundberg@gmail.com` — we need the same for contact submissions
  so Noah can reply from his own inbox without impersonating
  `support@`.

### Rate limiting

`docs/rate-limiting.md` documents two existing Workers rate-limit
bindings (`RL_AUTH` @ 10 req / 60s and `RL_BILLING` @ 20 req / 60s).
The helpers live in `app/domain/utils/rate-limit.server.ts`:

- `getRateLimiter(context, name)` pulls the binding from the context.
- `checkRateLimit({ limiter, key })` returns `{ ok: true }` or
  `{ ok: false, retryAfter: 60 }`. `defaultAllow: true` so local dev
  without the binding still works.
- `clientIpFromRequest(request)` — preferred key source. Uses
  `CF-Connecting-IP`, then first hop of `X-Forwarded-For`, then
  `"unknown"`.

Adding a new binding means editing `wrangler.jsonc` in two places:
the top-level `"ratelimits"` array (production, namespace `1003`)
AND `env.staging.ratelimits` (namespace `2003`). Tonight's
`ops-runbook` summary calls this out — don't forget staging.

### Form patterns in the repo

Existing auth forms use `zod-form-data` (`zfd`) on the server:

```ts
const schema = zfd.formData({
  email: zfd.text(z.string().trim().toLowerCase().email()),
  // …
});
const parsed = schema.safeParse(formData);
```

Examples to mirror: `app/routes/auth/forgot-password.tsx`,
`app/routes/auth/signup.tsx` (step 3 schema at line 103). Error
returns use `data({ error, field }, { status })` shape so the client
can highlight the offending field. Follow that convention.

### No spam protection today

No Turnstile / captcha / honeypot on any current form. `grep -i
"turnstile|captcha|honeypot"` returns zero hits. The IP rate limit is
the only defense layer today. A Contact form is a higher-value spam
target than signup (signup requires an email confirmation; contact
doesn't gate the outbound message at all), so this spec proposes a
minimal honeypot field as part of PR 1.

### Smoke sweep

`e2e/smoke.spec.ts` + `e2e/smoke-routes.ts` drive a zero-500 sweep
over every route. The contact route needs a `publicMarketingRoutes`
entry so both desktop + mobile sweeps pick it up without a code
change to `smoke.spec.ts` itself.

### Host gating

The existing marketing routes guard their actions with
`isMarketingHost(request, context)` (`app/routes/auth/signup.tsx`
line 110). A contact action on a tenant subdomain should redirect to
the marketing origin. Use `marketingOriginFromRequest(request,
context)` to build the redirect URL, same pattern as signup.

## Proposal

### Route + UX

One new public route at `app/routes/contact.tsx`:

- **Loader:** lightweight — returns `{ supportEmail }` read from
  `getSupportEmail(context)`. No auth guard. Reject tenant hosts with
  a redirect to `${marketingOriginFromRequest(...)}/contact`.
- **Action:** IP rate-limit → parse with `zfd.formData` → honeypot
  check → enqueue a `contact_form` email kind → return
  `{ ok: true }` for a same-page success state. Failures surface on
  the page via `useActionData`, same shape
  (`{ error: string, field?: string }`) the auth routes use.
- **UI:** one narrow page, same dark marketing theme as
  `/pricing` and `/faqs`. Fields: Name, Email, School name (optional),
  Topic (select: Sales / Support / Bug / Other), Message.
  Submit CTA "Send message". On success, swap the form for a
  confirmation panel: "Thanks — we've got your message. We'll reply
  to <email> within 1 business day."
- **Footer + nav link:** add a Contact entry between FAQs and
  Login / Support. Keep the existing `mailto:` "Support" link — it's
  useful for someone whose browser can't POST or who prefers their
  own mail client. Add Contact to the sticky marketing nav alongside
  Pricing / Blog / FAQs.

### Email plumbing

Add a new `ContactFormMessage` kind to `app/domain/email/types.ts`:

```ts
export type ContactFormMessage = {
  kind: "contact_form";
  /** Resolved from getSupportEmail(context) at send time. */
  to: string;
  senderName: string;
  senderEmail: string;
  schoolName: string | null;
  topic: "sales" | "support" | "bug" | "other";
  message: string;
  /** Client IP, surfaced in the mail footer for abuse triage. */
  senderIp: string | null;
  /** Epoch ms — sender saw the form at this time. */
  submittedAt: number;
};
```

Add it to the `SendableEmailMessage` union. Template goes in
`app/domain/email/templates/contact-form.ts` and gets registered in
the switch in `templates/index.ts`. The rendered email should:

- **Subject:** `"[Contact / ${topic}] ${senderName} — ${schoolName ?? 'no school'}"`
- **Reply-To:** the sender's email, so Noah can hit Reply and the
  reply lands in the sender's inbox directly (this is the big
  advantage over mailto — threaded replies without hunting for the
  address). This is the same mechanism `welcome.ts` uses.
- **Body (HTML + text):** straightforward key/value layout — From,
  Email, School, Topic, Message, IP, Submitted-at. No marketing
  template chrome; this is a transactional admin email to ourselves.

### Why enqueue instead of send directly

`enqueueEmail` returns immediately and logs a warning if the
`EMAIL_QUEUE` binding is missing (dev mode). Hitting Resend
synchronously from a public handler would tie the submitter's
response to Resend's latency and let a 500 from Resend surface as a
user-visible error — worse UX and worse for CS (we still want to
capture the message). The queue's default retry policy covers
transient Resend outages. This matches the pattern the existing
`ensureOrgForUser` welcome email uses (`app/domain/billing/onboarding.server.ts`).

### Rate limiting

New binding `RL_CONTACT` in `wrangler.jsonc`:

```jsonc
// production
{ "name": "RL_CONTACT", "namespace_id": "1003",
  "simple": { "limit": 1, "period": 60 } }

// env.staging
{ "name": "RL_CONTACT", "namespace_id": "2003",
  "simple": { "limit": 5, "period": 60 } }  // looser for easier manual testing
```

Key scheme: `"contact:<client-ip>"` via `clientIpFromRequest`. Queue
requests with 1/60s, return HTTP 429 + `Retry-After: 60` on miss —
same shape `signup` uses. Update `docs/rate-limiting.md` with a new
row in the bindings table, a row in the zone-level WAF reference
section ("consider a 100/min zone rule on /contact as outer belt"),
and the key scheme line. Staying consistent with that doc is a
merge-gate check in prior build nights — it's easier to edit in one
pass than fix in code review.

### Spam protection — honeypot only, no Turnstile in PR 1

Add a hidden `<input type="text" name="website">` with
`autocomplete="off"`, `tabindex="-1"`, and CSS `display: none`. If the
server sees any non-empty value, return `{ ok: true }` without
enqueuing — indistinguishable from a real success to the bot, but the
message is dropped. This is a 10-line change with zero runtime cost.

Turnstile would be nicer but adds: a `TURNSTILE_SITEKEY` + server
secret pair, a script tag on the page, a server-side verify call, and
a 5-layer test plan. Push to follow-up PR once we see real volume.

### "School name" optional but helpful

Not required — a parent or press inquiry legitimately wouldn't have
one. Label it "School or organization (optional)". When present,
include in the subject line; when absent, subject reads `"[Contact /
${topic}] ${senderName}"`.

## File list

| File | Change |
|---|---|
| `app/routes/contact.tsx` | **new** — loader + action + UI |
| `app/routes.ts` | add `route("contact", "routes/contact.tsx")` in the public section, near `route("pricing", …)` |
| `app/domain/email/types.ts` | add `ContactFormMessage` type + add to `SendableEmailMessage` union |
| `app/domain/email/templates/contact-form.ts` | **new** — renderer |
| `app/domain/email/templates/index.ts` | register `case "contact_form"` in the `renderEmail` switch |
| `app/components/Footer.tsx` | add `<Link to="/contact">Contact</Link>` between FAQs and Login |
| `app/components/marketing/MarketingNav.tsx` | add Contact link alongside Pricing / Blog / FAQs |
| `wrangler.jsonc` | add `RL_CONTACT` binding to top-level `ratelimits` (`1003`) AND `env.staging.ratelimits` (`2003`) |
| `docs/rate-limiting.md` | add row for `RL_CONTACT` + key scheme |
| `e2e/smoke-routes.ts` | add `/contact` to `publicMarketingRoutes` with landmark text |
| `e2e/flows/contact.spec.ts` | **new** — end-to-end happy path + rate-limit test |
| `app/routes/contact.test.ts` | **new** — unit tests for the action (honeypot, rate limit, validation) |
| `app/domain/email/templates/contact-form.test.ts` | **new** — renderer snapshot for HTML + text |

No Prisma schema changes. No new dependencies.

## Testing approach

### Unit tests

`app/routes/contact.test.ts` — mock `context.cloudflare.env` with
stubs for `EMAIL_QUEUE` (a `.send` spy) and `RL_CONTACT` (a `.limit`
spy). Cases:

1. Valid submission → action returns `{ ok: true }`, enqueue called
   once with the expected `ContactFormMessage` shape, rate-limit
   called with `"contact:<ip>"` key.
2. Missing required field (name, email, message, topic) → returns
   `{ error, field }` with `status: 400`; enqueue NOT called.
3. Invalid email (bad format) → returns `{ error, field: "email" }`;
   enqueue NOT called.
4. Honeypot non-empty → returns `{ ok: true }`; enqueue NOT called
   (silent drop).
5. Rate limit miss → returns `{ error: "Too many…" }` with
   `status: 429` and `Retry-After: 60`.
6. Tenant host → action returns a `redirect` to the marketing origin.
7. Message > 5000 chars → rejected with a field-specific error.

`app/domain/email/templates/contact-form.test.ts`:

- Snapshot the rendered HTML + text for a fixed input (happy path +
  no-school variant).
- Assert `replyTo` equals the sender's email.
- Assert subject includes topic + sender name.

### E2E test

`e2e/flows/contact.spec.ts` (uses the smoke's existing marketing
fixtures — no seeded tenant needed):

1. Navigate `/contact`. Assert the form renders with the five fields.
2. Fill the form with a unique message string. Submit. Assert the
   confirmation panel shows and contains the sender's email.
3. Assert (optional if hard) that the page's `action` returned a
   2xx — can just assert DOM state.
4. **Rate-limit path:** submit twice in quick succession. Expect the
   second submission to render the 429 error copy inline. This only
   works if the staging binding is set to a low enough limit to hit;
   the spec proposes 5/60s for staging specifically so this test is
   feasible without flaking in parallel runs.
5. **Honeypot path:** programmatically fill the hidden `website`
   input via `page.evaluate`. Submit. Assert the confirmation panel
   still renders (the user can't tell). Add a `// Assert enqueue
   didn't fire`-style check only if there's a way to observe the
   queue — otherwise leave this as a unit-test-only assertion.

### Smoke coverage

Add to `e2e/smoke-routes.ts`:

```ts
{
  path: "/contact",
  expect: "self",
  landmark: { text: "Contact us" }, // adjust to the actual H1
}
```

Smoke sweeps pass if the page loads with no pageerror and the
landmark text is visible. The mobile sweep reuses this automatically.

### Gate notes

- Docs-only rate-limiting-doc change shouldn't affect typecheck.
- Adding a new email kind requires the `renderEmail` switch to stay
  exhaustive, so leaving it out will fail typecheck — good; the
  compiler enforces the pattern.

## Open questions

1. **Turnstile timing.** Ship the honeypot-only version first and
   add Turnstile the first time we see non-trivial spam? Or add it in
   PR 1 because the form is an outbound-email amplifier? Recommendation:
   ship honeypot now, add Turnstile in a follow-up. Noah decides.

2. **Storing submissions in the DB.** Should we add a `ContactSubmission`
   Prisma model so submissions survive a Resend outage and we have a
   searchable history? Queue-only means a dropped message is gone
   with minimal trace (the queue DLQ catches *delivery* failures but
   not *queue-enqueue* failures, which can't currently fail in a way
   we'd notice). Recommendation: defer to a follow-up — the queue +
   Resend log is enough for the first release — but flag it as a
   known gap.

3. **Topic → different recipient?** Today every topic goes to
   `SUPPORT_EMAIL`. Should Sales go to `sales@…`, Bug go to
   `engineering@…`, etc.? Recommendation: single address for PR 1;
   Noah can grep the subject line. Add a routing table in a later
   PR if volume justifies it.

4. **Auto-reply to the sender.** Should we also enqueue a
   sender-facing ack email ("We got your message")? Nice to have,
   but doubles the blast radius of a misconfigured `RESEND_API_KEY`.
   Recommendation: out of scope for PR 1; the on-page confirmation
   panel is enough.

5. **Link placement in the nav.** Marketing nav is already
   dense (Pricing, Blog, FAQs, Log in, Sign up). Adding Contact
   makes it 6 items on mobile. Acceptable? Or drop it to the footer
   only? Recommendation: keep it in the nav; it's a primary
   conversion affordance. If it pushes the nav over on narrow
   screens, that's a responsive-nav problem to solve separately.

6. **Character limits.** `message` should probably cap at ~5000
   chars. `name` at 200, `schoolName` at 200, `email` at 254 (RFC
   5321). Enforce server-side via `zfd.text(z.string().max(…))` and
   surface an HTML `maxlength` so the client catches it early. No
   UX debate needed — these are industry-standard bounds.

7. **Accessibility.** `design:accessibility-review` should run on
   the form before merge. Current auth forms use implicit labels
   with `<label>…<input>`; keep the same pattern so we don't regress
   on the signup-form `for`/`id` fix that just landed
   (`255f304 fix(signup,a11y): associate form labels with inputs`).

## Out of scope (explicit)

- In-app ticket system / ticket IDs / threading UI.
- Turnstile integration (deferred per Q1).
- Auto-reply email to the sender (deferred per Q4).
- Per-topic routing to different addresses (deferred per Q3).
- A `ContactSubmission` Prisma model (deferred per Q2).
- Marketing-nav responsive redesign (deferred per Q5).
- File attachments. Add later if pilots ask for it.
