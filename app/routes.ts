import {
  index,
  prefix,
  route,
  type RouteConfig
} from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),

  // Admin routes — restricted to ADMIN role
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/dashboard.tsx"),
    route("users", "routes/admin/users.tsx"),
    route("households", "routes/admin/households.tsx"),
    route("households/:householdId", "routes/admin/households.$householdId.tsx"),
    route("children", "routes/admin/children.tsx"),
    route("students/:studentId", "routes/admin/students.$studentId.tsx"),
    route("roster-import", "routes/admin/roster-import.tsx"),
    route("billing", "routes/admin/billing.tsx"),
    route("branding", "routes/admin/branding.tsx"),
    route("history", "routes/admin/history.tsx"),
    route("drills", "routes/admin/drills.tsx"),
    // /admin/drills/library and /admin/drills/history — must come BEFORE the
    // :templateId param route so they don't get swallowed by the dynamic
    // segment. The history detail route uses a distinct first segment so it
    // can't collide with templateId.
    route("drills/library", "routes/admin/drills.library.tsx"),
    route("drills/history", "routes/admin/drills.history.tsx"),
    route("drills/history/:runId", "routes/admin/drills.history.$runId.tsx"),
    route("drills/:templateId/run", "routes/admin/drills.$templateId.run.tsx"),
    route("drills/:templateId", "routes/admin/drills.$templateId.tsx"),
    route("profile", "routes/admin/profile.tsx"),
  ]),

  // Live drill takeover — every signed-in user gets redirected here when their
  // org has a LIVE or PAUSED DrillRun (see app/root.tsx loader).
  route("drills/live", "routes/drills.live.tsx"),

  // Print routes — standalone (no admin chrome) so browser Cmd+P output is clean
  route("admin/roster-template.csv", "routes/admin/roster-template.csv.ts"),
  route("admin/print/board", "routes/admin/print.board.tsx"),
  route("admin/print/master", "routes/admin/print.master.tsx"),
  route("admin/print/homeroom/:teacherId", "routes/admin/print.homeroom.$teacherId.tsx"),
  route("admin/print/drills/:templateId", "routes/admin/print.drills.$templateId.tsx"),

  // Legacy /admin/fire-drill* → /admin/drills* 308 redirects (remove after one release cycle).
  route("admin/fire-drill", "routes/_redirects/fire-drill.ts", { id: "legacy-fire-drill-index" }),
  route("admin/fire-drill/*", "routes/_redirects/fire-drill.ts", { id: "legacy-fire-drill-splat" }),
  route("admin/print/fire-drill/*", "routes/_redirects/fire-drill.ts", { id: "legacy-print-fire-drill-splat" }),

  ...prefix("create", [
    route("homeroom", "routes/create/create.homeroom.tsx"),
    route("student", "routes/create/create.student.tsx")
  ]),

  ...prefix("edit", [
    route("homeroom/:homeroom", "routes/edit/edit.homeroom.$value.tsx")
  ]),

  route("data/students", "routes/data.students.tsx"),
  route("empty/:space", "routes/empty.$space.tsx"),
  route("update/:space", "routes/update.$space.tsx"),

  route("homerooms", "routes/homerooms.tsx", [
    route(":id", "routes/homerooms.$id.tsx")
  ]),

  // Auth routes
  route("api/auth/*", "routes/api/auth.ts"),
  route("api/check-email", "routes/api/check-email.ts"),
  route("api/check-org-slug", "routes/api/check-org-slug.ts"),
  route("api/branding/logo/:slug", "routes/api/branding.logo.$slug.ts"),
  route("api/user-prefs", "routes/api/user-prefs.tsx"),
  route("api/onboarding", "routes/api/onboarding.ts"),
  route("api/webhooks/stripe", "routes/api/webhooks.stripe.ts"),
  route("api/healthz", "routes/api/healthz.ts"),
  // Worker-to-worker: BingoBoardDO alarm POSTs presence snapshots here.
  // HMAC-authenticated; not user-facing.
  route(
    "api/drill-runs/:runId/presence-sample",
    "routes/api/drill-runs.$runId.presence-sample.ts",
  ),
  route("api/billing/checkout", "routes/api/billing.checkout.ts"),
  route("api/billing/portal", "routes/api/billing.portal.ts"),
  route("billing/success", "routes/billing.success.tsx"),
  route("billing/cancel", "routes/billing.cancel.tsx"),
  route("login", "routes/auth/login.tsx"),
  route("forgot-password", "routes/auth/forgot-password.tsx"),
  route("reset-password", "routes/auth/reset-password.tsx"),
  route("viewer-access", "routes/viewer-access.tsx"),
  route("signup", "routes/auth/signup.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("faqs", "routes/faqs.tsx"),
  route("blog", "routes/blog._index.tsx"),
  route("blog/:slug", "routes/blog.$slug.tsx"),
  route("guides", "routes/guides._index.tsx"),
  route("guides/:slug", "routes/guides.$slug.tsx"),
  route("status", "routes/status.tsx"),

  route("platform", "routes/platform/layout.tsx", [
    index("routes/platform/index.tsx"),
    route("users", "routes/platform/users.tsx"),
    route("orgs/new", "routes/platform/orgs.new.tsx"),
    route("orgs/:orgId", "routes/platform/orgs.$orgId.tsx"),
    route("signups", "routes/platform/signups.tsx"),
    route("sessions", "routes/platform/sessions.tsx"),
    route("sessions/revoke", "routes/platform/sessions.revoke.ts"),
    route("webhooks", "routes/platform/webhooks.tsx"),
    route("webhooks/:eventId", "routes/platform/webhooks.$eventId.tsx"),
    route("audit", "routes/platform/audit.tsx"),
    route("districts", "routes/platform/districts.tsx"),
    route("districts/:slug", "routes/platform/districts.$slug.tsx"),
  ]),

  // District portal — district admins only (role-routed from /login).
  // /district/signup is public and lives outside the layout.
  route("district/signup", "routes/district/signup.tsx"),
  route("district", "routes/district/layout.tsx", [
    index("routes/district/index.tsx"),
    route("schools", "routes/district/schools.tsx"),
    route("schools/new", "routes/district/schools.new.tsx"),
    route("schools/:orgId", "routes/district/schools.$orgId.tsx"),
    route("schools/:orgId/impersonate", "routes/district/schools.$orgId.impersonate.tsx"),
    route("admins", "routes/district/admins.tsx"),
    route("billing", "routes/district/billing.tsx"),
    route("billing/portal", "routes/district/billing.portal.tsx"),
    route("audit", "routes/district/audit.tsx"),
    route("impersonate/end", "routes/district/impersonate.end.tsx"),
    route("profile", "routes/district/profile.tsx"),
  ]),

  route("billing-required", "routes/billing-required.tsx"),
  route("logout", "routes/auth/logout.ts"),
  route("set-password", "routes/set-password.tsx"),
  route("accept-invite", "routes/accept-invite.tsx")
] satisfies RouteConfig;
