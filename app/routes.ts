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
    route("children", "routes/admin/children.tsx"),
    route("billing", "routes/admin/billing.tsx"),
    route("branding", "routes/admin/branding.tsx"),
    route("fire-drill", "routes/admin/fire-drill.tsx"),
    route("fire-drill/:templateId/run", "routes/admin/fire-drill.$templateId.run.tsx"),
    route("fire-drill/:templateId", "routes/admin/fire-drill.$templateId.tsx"),
  ]),

  // Print routes — standalone (no admin chrome) so browser Cmd+P output is clean
  route("admin/print/board", "routes/admin/print.board.tsx"),
  route("admin/print/master", "routes/admin/print.master.tsx"),
  route("admin/print/homeroom/:teacherId", "routes/admin/print.homeroom.$teacherId.tsx"),
  route("admin/print/fire-drill/:templateId", "routes/admin/print.fire-drill.$templateId.tsx"),

  ...prefix("create", [
    route("homeroom", "routes/create/create.homeroom.tsx"),
    route("student", "routes/create/create.student.tsx")
  ]),

  ...prefix("edit", [
    route("homeroom/:homeroom", "routes/edit/edit.homeroom.$value.tsx"),
    route("student/:student", "routes/edit/edit.student.$value.tsx")
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
  route("status", "routes/status.tsx"),

  route("platform", "routes/platform/layout.tsx", [
    index("routes/platform/index.tsx"),
    route("orgs/new", "routes/platform/orgs.new.tsx"),
    route("orgs/:orgId", "routes/platform/orgs.$orgId.tsx"),
    route("signups", "routes/platform/signups.tsx"),
    route("sessions", "routes/platform/sessions.tsx"),
    route("sessions/revoke", "routes/platform/sessions.revoke.ts"),
    route("webhooks", "routes/platform/webhooks.tsx"),
    route("webhooks/:eventId", "routes/platform/webhooks.$eventId.tsx"),
    route("audit", "routes/platform/audit.tsx"),
  ]),

  route("billing-required", "routes/billing-required.tsx"),
  route("logout", "routes/auth/logout.ts"),
  route("set-password", "routes/set-password.tsx")
] satisfies RouteConfig;
