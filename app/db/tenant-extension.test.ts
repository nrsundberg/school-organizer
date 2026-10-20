import test from "node:test";
import assert from "node:assert/strict";
import { isTenantScopedModel } from "./tenant-extension";

test("OrgAuditLog is tenant-scoped so a school admin query cannot read every org", () => {
  assert.equal(isTenantScopedModel("OrgAuditLog"), true);
});

test("auth and global tables stay unscoped and must be filtered by the caller", () => {
  assert.equal(isTenantScopedModel("User"), false);
  assert.equal(isTenantScopedModel("Session"), false);
  assert.equal(isTenantScopedModel("Org"), false);
  assert.equal(isTenantScopedModel("StripeWebhookEvent"), false);
  assert.equal(isTenantScopedModel("SupportTicket"), false);
  assert.equal(isTenantScopedModel("SupportTicketMessage"), false);
  assert.equal(isTenantScopedModel("HelpChatQuota"), false);
});
