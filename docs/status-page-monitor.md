# Status-page external monitor

`/status` reports the health of four components from an **external uptime
monitor** (UptimeRobot, Cloudflare Health Checks, Better Stack, etc.) instead
of cron-driven HTTP probes. The cron worker can't reliably fetch its own zone
— same-zone fetches loop back through the Cloudflare edge and time out (522).
External probes also keep working when the worker itself is down, which is the
whole point of a status page.

The other components (D1, Queues, R2, Stripe, Resend) stay on the cron because
they need worker-internal bindings or are best fed by external status feeds.

## Architecture

```
UptimeRobot ──HTTPS──▶  https://pickuproster.com/  (and 3 others)
   │
   │   when up/down transitions, also:
   ▼
   POST https://pickuproster.com/api/status-probe
        X-Status-Probe-Secret: <STATUS_PROBE_SECRET>
        { "componentId": "marketing", "status": "operational" | "outage", ... }
                     │
                     ▼
              recordProbeResult(...)
                     │
                     ▼
        StatusCheck row + StatusIncident state machine
```

## One-time setup

### 1. Set the shared secret

```sh
# Pick something long and random.
openssl rand -hex 32

wrangler secret put STATUS_PROBE_SECRET --env production
# paste the value at the prompt

# Repeat for staging if you also wire monitors there:
wrangler secret put STATUS_PROBE_SECRET --env staging
```

If `STATUS_PROBE_SECRET` is missing on the deploy, `/api/status-probe` returns
503 — fail-closed, never anonymous-write.

### 2. Configure the monitors

Create four HTTP(s) checks. Each one pings the URL on its normal interval AND
fires a webhook on **both** "up" and "down" transitions so the state machine
sees `operational` and `outage` consistently.

| componentId         | Check URL                                   | Up condition                          |
|---------------------|---------------------------------------------|---------------------------------------|
| `marketing`         | `https://pickuproster.com/`                 | HTTP 200 + body contains `Pickup Roster` |
| `auth`              | `https://pickuproster.com/login`            | HTTP 200                              |
| `app_workers`       | `https://pickuproster.com/api/healthz`      | HTTP 200 + body contains `"ok":true`  |
| `tenants_aggregate` | `https://demo.pickuproster.com/`            | HTTP 2xx/3xx (redirect to /login is fine) |

Pick a stable canary tenant slug for `tenants_aggregate` (the `demo` org is
created by the dev seed; pick whatever you settle on for the prod canary —
worth a row in `Org` that's never deleted).

### 3. Webhook payload

For each monitor, configure two webhooks (or one webhook fired on both
transitions, depending on the provider).

- **Method**: `POST`
- **URL**: `https://pickuproster.com/api/status-probe`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Status-Probe-Secret: <STATUS_PROBE_SECRET>`
- **Body** (JSON):

```json
{
  "componentId": "marketing",
  "status": "operational",
  "latencyMs": 142,
  "detail": null
}
```

`status` must be one of `operational` | `degraded` | `outage` | `unknown`.
`componentId` must match one of the IDs above. UptimeRobot/Better Stack support
templating the latency and current state into the body.

For "down" transitions, send `"status": "outage"` (or `"degraded"` for partial
failures the monitor distinguishes); the route accepts an optional
`detail` string up to 500 chars (e.g. the monitor's own error description).

### 4. Verify end-to-end

```sh
# Should be 401 — no secret
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST https://pickuproster.com/api/status-probe \
  -H 'content-type: application/json' \
  -d '{"componentId":"marketing","status":"operational"}'

# Should be 200
curl -sS -X POST https://pickuproster.com/api/status-probe \
  -H 'content-type: application/json' \
  -H "X-Status-Probe-Secret: $STATUS_PROBE_SECRET" \
  -d '{"componentId":"marketing","status":"operational"}'

# Confirm the row landed
wrangler d1 execute school-organizer --remote \
  --command "SELECT componentId, status, datetime(checkedAt) FROM StatusCheck ORDER BY checkedAt DESC LIMIT 5"
```

After two consecutive `operational` POSTs per component, the state machine
auto-resolves any open incident — no manual DB cleanup needed.

## Operations

### Rotating the secret

1. Generate a new value: `openssl rand -hex 32`.
2. Update both monitors and the worker secret in a tight window — there's no
   second-secret window, so a stale monitor will start getting 401s during the
   gap. Keep it short.

   ```sh
   wrangler secret put STATUS_PROBE_SECRET --env production
   ```

3. Update the `X-Status-Probe-Secret` header on every monitor's webhook config.

### Adding a new component

1. Append to `app/domain/status/components.ts` with `probe: "external"`.
2. Add a matching ID to `ComponentId` in `app/domain/status/types.ts` so the
   webhook validates it (otherwise it returns 400 on the new ID).
3. Set up a monitor for it.

### What if the monitor itself goes down?

The cron skips external components, so a silent monitor produces zero new
rows for those `componentId`s. The 90-day grid treats "no checks for a day"
as `unknown` (gray) — no false-positive outage, just a visible gap.

If you see a gray streak across consecutive days, check the monitor before
assuming prod is up. If you want a hard "monitor down" alert, also configure
the uptime provider to alert when its own heartbeat fails (most providers
support this — UptimeRobot's "Cron Job" monitor type, Better Stack's
heartbeat URL, etc.).
