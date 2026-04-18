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
    route("branding", "routes/admin/branding.tsx"),
  ]),

  // Print routes — standalone (no admin chrome) so browser Cmd+P output is clean
  route("admin/print/board", "routes/admin/print.board.tsx"),
  route("admin/print/master", "routes/admin/print.master.tsx"),
  route("admin/print/homeroom/:teacherId", "routes/admin/print.homeroom.$teacherId.tsx"),

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
  route("api/branding/logo/:slug", "routes/api/branding.logo.$slug.ts"),
  route("api/user-prefs", "routes/api/user-prefs.tsx"),
  route("api/onboarding", "routes/api/onboarding.ts"),
  route("api/webhooks/stripe", "routes/api/webhooks.stripe.ts"),
  route("login", "routes/auth/login.tsx"),
  route("viewer-access", "routes/viewer-access.tsx"),
  route("signup", "routes/auth/signup.tsx"),
  route("billing-required", "routes/billing-required.tsx"),
  route("logout", "routes/auth/logout.ts"),
  route("set-password", "routes/set-password.tsx")
] satisfies RouteConfig;
