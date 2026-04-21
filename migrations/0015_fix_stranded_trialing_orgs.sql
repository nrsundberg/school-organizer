-- Fix stranded orgs sitting in INCOMPLETE despite having an active trial window.
--
-- Background: orgs created on a paid plan (CAR_LINE / CAMPUS) via the onboarding
-- flow were initialized with status = 'INCOMPLETE' until a Stripe webhook
-- (customer.subscription.created with status='trialing') flipped them to
-- 'TRIALING'. When that webhook is delayed, dropped, or raced by a page load,
-- the org is stuck on the "Billing Action Required" screen even though it has
-- a valid trial period remaining. See isOrgStatusAllowedForApp — only ACTIVE,
-- TRIALING, PAST_DUE are usable.
--
-- Fix: promote any org that (a) is still in INCOMPLETE, (b) has a trial window
-- that started and has not yet ended, to TRIALING. This is conservative:
--   - Does NOT touch INCOMPLETE_EXPIRED / CANCELED / SUSPENDED (terminal-ish).
--   - Does NOT touch orgs without a trialEndsAt (those genuinely have no trial).
--   - Does NOT touch orgs whose trial already elapsed (trialEndsAt <= now).
--   - Leaves stripeCustomerId / stripeSubscriptionId / billingPlan untouched so
--     the next webhook can still reconcile the record.
--
-- Invariant preserved: an org whose runtime state is "active trial" must have
-- status = 'TRIALING'. After this migration, no org with trialEndsAt in the
-- future sits in INCOMPLETE.
UPDATE "Org"
SET "status" = 'TRIALING'
WHERE "status" = 'INCOMPLETE'
  AND "trialEndsAt" IS NOT NULL
  AND "trialEndsAt" > CURRENT_TIMESTAMP
  AND "trialStartedAt" IS NOT NULL;
