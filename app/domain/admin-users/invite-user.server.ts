import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { assertUserScopeXor } from "~/domain/auth/user-scope.server";
import {
  buildInviteUrl,
  createInviteToken,
} from "~/domain/auth/user-invite.server";
import { enqueueEmail } from "~/domain/email/queue.server";
import { recordOrgAudit } from "~/domain/billing/comp.server";
import { writeDistrictAudit } from "~/domain/district/audit.server";
import { isDuplicateUserError } from "./admin-users.server";

/**
 * Unified "staff invites a user" entry point. Used by:
 *   - /platform/users (invite a PLATFORM_ADMIN)
 *   - /platform/orgs/:orgId (invite a user under that org)
 *   - /admin/users (org admins inviting users into their own org)
 *   - /district/admins (district admins inviting other district admins)
 *   - provisionSchoolForDistrict (initial school admin)
 *
 * Creates a passwordless user shell (the random password is immediately
 * unknown to anyone — it gets overwritten when the invitee accepts), then
 * issues a single-use invite token and enqueues the invite email. The
 * email contains a link to /accept-invite?token=... which is the only
 * way the user can finish onboarding.
 */

export type InviteScope =
  | { kind: "platform" }
  | { kind: "district"; id: string }
  | { kind: "org"; id: string };

export type InviteUserInput = {
  /** The originating request — used for admin auth headers + origin. */
  request: Request;
  email: string;
  name: string;
  scope: InviteScope;
  /**
   * Role the user will hold once they accept. Validated against the
   * scope: `PLATFORM_ADMIN` for platform, `ADMIN`/`CONTROLLER`/`VIEWER`
   * for org, `ADMIN` for district.
   */
  role: string;
  /** Userid of the staff member issuing the invite. */
  invitedByUserId: string | null;
  /** Email of the staff member issuing the invite (for audit). */
  invitedByEmail?: string | null;
  /**
   * Friendly label for the invite email body — usually the org or
   * district name. Null is fine; the template falls back to a generic
   * "Pickup Roster team" string.
   */
  invitedToLabel?: string | null;
};

export type InviteUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: InviteUserError };

export type InviteUserError =
  | "invalid-scope-role"
  | "invalid-email"
  | "invalid-name"
  | "user-exists"
  | "create-failed";

const VALID_ORG_ROLES = new Set(["ADMIN", "CONTROLLER", "VIEWER"]);
const VALID_DISTRICT_ROLES = new Set(["ADMIN"]);
const VALID_PLATFORM_ROLES = new Set(["PLATFORM_ADMIN"]);

export function validateScopeAndRole(
  scope: InviteScope,
  role: string,
): boolean {
  if (scope.kind === "org") return VALID_ORG_ROLES.has(role);
  if (scope.kind === "district") return VALID_DISTRICT_ROLES.has(role);
  if (scope.kind === "platform") return VALID_PLATFORM_ROLES.has(role);
  return false;
}

/**
 * Generate a random password we never tell anyone. The accept-invite
 * flow overwrites the Account row's hashed password before the user can
 * use it. We still set one because better-auth's signUpEmail requires
 * it and creates a credential Account row in the same call.
 */
function unknowablePassword(): string {
  return crypto.randomUUID() + crypto.randomUUID() + "Aa1!";
}

export async function inviteUser(
  context: any,
  input: InviteUserInput,
): Promise<InviteUserResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email || !/.+@.+\..+/.test(email)) {
    return { ok: false, error: "invalid-email" };
  }
  if (!name) {
    return { ok: false, error: "invalid-name" };
  }
  if (!validateScopeAndRole(input.scope, input.role)) {
    return { ok: false, error: "invalid-scope-role" };
  }
  // Pre-flight: catch the obvious "already on the platform" case before
  // we hit better-auth so the error shows up the same way for every
  // caller. better-auth would also reject, but its error shape varies.
  const db = getPrisma(context);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "user-exists" };

  // Cross-check the XOR invariant — better-auth's user.create hook does
  // this too, but failing here gives a cleaner error path.
  try {
    assertUserScopeXor({
      orgId: input.scope.kind === "org" ? input.scope.id : null,
      districtId: input.scope.kind === "district" ? input.scope.id : null,
      isPlatformAdmin: input.scope.kind === "platform",
    });
  } catch {
    return { ok: false, error: "invalid-scope-role" };
  }

  const auth = getAuth(context);
  let signup;
  try {
    signup = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password: unknowablePassword(),
      },
    });
  } catch (err) {
    if (isDuplicateUserError(err)) {
      return { ok: false, error: "user-exists" };
    }
    return { ok: false, error: "create-failed" };
  }
  const userId = signup?.user?.id;
  if (!userId) return { ok: false, error: "create-failed" };

  // Apply scope + role + mustChangePassword in one update. Even though
  // the random password is unguessable, mustChangePassword is the
  // belt-and-suspenders fallback: if the Account row's hash is somehow
  // discovered before the invite is consumed, the existing /set-password
  // gate kicks in on next login.
  const userPatch: Record<string, unknown> = {
    role: input.role,
    mustChangePassword: true,
  };
  if (input.scope.kind === "org") userPatch.orgId = input.scope.id;
  if (input.scope.kind === "district") userPatch.districtId = input.scope.id;

  await db.user.update({ where: { id: userId }, data: userPatch });

  const { rawToken, expiresAt } = await createInviteToken(context, {
    userId,
    invitedByUserId: input.invitedByUserId,
  });

  const inviteUrl = buildInviteUrl(input.request, context, rawToken);
  const expiryDays = Math.max(
    1,
    Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000),
  );

  await enqueueEmail(context, {
    kind: "user_invite",
    to: email,
    firstName: firstNameFromUserName(name),
    inviteUrl,
    expiryDays,
    invitedToLabel: input.invitedToLabel ?? null,
  });

  // Audit. Org/district scopes have dedicated audit tables; platform
  // invites don't have a top-level table yet, so we lean on the queue
  // log and skip — the platform/audit page reads from per-tenant logs.
  if (input.scope.kind === "org") {
    await recordOrgAudit({
      context,
      orgId: input.scope.id,
      actorUserId: input.invitedByUserId,
      action: "user.invited",
      payload: { email, role: input.role, userId },
    });
  } else if (input.scope.kind === "district") {
    await writeDistrictAudit(context, {
      districtId: input.scope.id,
      actorUserId: input.invitedByUserId,
      actorEmail: input.invitedByEmail ?? null,
      action: "district.admin.invited",
      targetType: "User",
      targetId: userId,
      details: { invitedEmail: email },
    });
  }

  return { ok: true, userId };
}

/**
 * Re-issue an invite for an existing user who hasn't accepted yet.
 * Revokes any prior pending invites (handled inside `createInviteToken`)
 * and sends a fresh email. Returns the user's email on success so the
 * caller can put it in a toast.
 */
export async function resendInvite(
  context: any,
  args: {
    request: Request;
    userId: string;
    invitedByUserId: string | null;
    invitedToLabel?: string | null;
  },
): Promise<
  | { ok: true; email: string }
  | { ok: false; error: "user-not-found" | "already-active" }
> {
  const db = getPrisma(context);
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { id: true, email: true, name: true, mustChangePassword: true },
  });
  if (!user) return { ok: false, error: "user-not-found" };
  if (!user.mustChangePassword) {
    // The user has already set a password — use forgot-password if they
    // can't sign in. Resending invites for active users would let any
    // staff member silently take their account.
    return { ok: false, error: "already-active" };
  }

  const { rawToken, expiresAt } = await createInviteToken(context, {
    userId: user.id,
    invitedByUserId: args.invitedByUserId,
  });
  const inviteUrl = buildInviteUrl(args.request, context, rawToken);
  const expiryDays = Math.max(
    1,
    Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000),
  );
  await enqueueEmail(context, {
    kind: "user_invite",
    to: user.email,
    firstName: firstNameFromUserName(user.name),
    inviteUrl,
    expiryDays,
    invitedToLabel: args.invitedToLabel ?? null,
  });
  return { ok: true, email: user.email };
}

function firstNameFromUserName(name: string | null | undefined): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}
