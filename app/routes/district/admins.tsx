import { Button, Input } from "@heroui/react";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/admins";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getPrisma } from "~/db.server";
import { getAuth } from "~/domain/auth/better-auth.server";
import { writeDistrictAudit } from "~/domain/district/audit.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

function generateTempPassword(): string {
  // Long random — the new admin resets via /forgot-password on first login.
  return crypto.randomUUID() + "Aa1!";
}

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const db = getPrisma(context);
  const admins = await db.user.findMany({
    where: { districtId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  return { admins };
}

export default function DistrictAdmins({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { admins } = loaderData;
  const error = (actionData as { error?: string } | undefined)?.error;
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">District admins</h2>
        <p className="text-sm text-white/50">
          District admins can add schools, view dashboards, and impersonate
          into any school in the district.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-t border-white/10">
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2 text-white/70">{a.email}</td>
                <td className="px-3 py-2 text-white/50">
                  {new Date(a.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="font-medium">Invite another admin</h3>
        <p className="mb-3 text-xs text-white/50">
          They&rsquo;ll receive a link to set their password on first login.
        </p>
        <Form method="post" className="grid max-w-md gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-white/80">Name</span>
            <Input name="name" required />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-white/80">Email</span>
            <Input name="email" type="email" required autoComplete="off" />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button
            type="submit"
            variant="primary"
            className="w-fit bg-[#E9D500] font-semibold text-[#193B4B]"
          >
            Send invite
          </Button>
        </Form>
      </div>
    </section>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const actor = getOptionalUserFromContext(context);
  if (!actor) throw new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!name || !email) return { error: "Name and email are required." };

  const auth = getAuth(context);
  let signup;
  try {
    signup = await auth.api.signUpEmail({
      body: { name, email, password: generateTempPassword() },
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not create the user.",
    };
  }
  if (!signup?.user?.id) return { error: "Could not create the user." };

  const db = getPrisma(context);
  await db.user.update({
    where: { id: signup.user.id },
    data: { districtId, role: "ADMIN" },
  });

  // TODO(v1.5): send district-admin-invite email so the new admin gets a
  // set-password link directly. For v1 they use /forgot-password to reset.
  console.log(
    `[district] invited admin ${email} to district ${districtId}; ` +
      "user must use /forgot-password to set their password (no invite email yet)",
  );

  await writeDistrictAudit(context, {
    districtId,
    actorUserId: actor.id,
    actorEmail: (actor as { email?: string }).email ?? null,
    action: "district.admin.invited",
    targetType: "User",
    targetId: signup.user.id,
    details: { invitedEmail: email },
  });

  throw redirect("/district/admins");
}
