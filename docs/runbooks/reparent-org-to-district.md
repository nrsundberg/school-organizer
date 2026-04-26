# Reparent a standalone org under a district

Use when sales has signed a district contract that includes a customer who
already has a standalone Pickup Roster account.

## Pre-flight

1. Confirm the Org's per-school Stripe subscription is canceled (or will be
   credited). District billing replaces it.
2. Confirm the District has a Stripe customer attached (`stripeCustomerId`
   set) — visit `/platform/districts/<slug>` and check the contract panel.

## Local / staging (libsql)

```bash
DATABASE_URL=file:./dev.db npx tsx scripts/reparent-org-to-district.ts <orgId> <districtId>
```

## Production (D1)

The reparent script hits `DATABASE_URL` via libsql, which doesn't reach D1.
For prod, run the equivalent SQL through `wrangler d1 execute`:

```bash
ORG_ID="..."
DISTRICT_ID="..."

npx wrangler d1 execute school-organizer --remote \
  --command "UPDATE \"Org\" SET \"districtId\" = '$DISTRICT_ID' WHERE id = '$ORG_ID';"

# Generate a cuid-shaped id for the audit row beforehand (any unique string
# works — keep it short).
AUDIT_ID="c$(date +%s%N | sha256sum | head -c20)"

npx wrangler d1 execute school-organizer --remote \
  --command "INSERT INTO \"DistrictAuditLog\" (id, districtId, action, targetType, targetId, details, createdAt) VALUES ('$AUDIT_ID', '$DISTRICT_ID', 'district.school.created', 'Org', '$ORG_ID', '{\"reparentedFromStandalone\":true}', CURRENT_TIMESTAMP);"
```

## Post-flight

1. Visit `/platform/districts/<districtSlug>` — confirm the org appears in
   audit log.
2. Visit the district portal — confirm the org appears in the schools list
   with the right counts.
3. Notify the school admin that billing has moved.
