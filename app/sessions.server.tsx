import { redirect } from "react-router";
import { redirectWithError } from "remix-toast";
import {
  getOptionalUserFromContext,
  getUserFromContext,
} from "~/domain/utils/global-context.server";

export async function requireRole(context: any, ...allowedRoles: string[]) {
  const user = getOptionalUserFromContext(context);
  if (!user || !allowedRoles.includes(user.role)) {
    throw await redirectWithError("/", "Not Authorized");
  }
  return user;
}

export async function protectRoute(context: any) {
  return requireRole(context, "ADMIN", "CONTROLLER");
}

export async function protectToAdminAndGetPermissions(context: any) {
  const user = getOptionalUserFromContext(context);
  if (!user) {
    throw new Response("Not authenticated", { status: 401 });
  }
  if (user.role !== "ADMIN" && user.role !== "CONTROLLER") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

export { getOptionalUserFromContext, getUserFromContext };
