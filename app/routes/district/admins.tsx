import { Button, Input } from "@heroui/react";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/admins";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import { getPrisma } from "~/db.server";
import {
  getActorIdsFromContext,
  getOptionalUserFromContext,
} from "~/domain/utils/global-context.server";
import { inviteUser } from "~/domain/admin-users/invite-user.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const db = getPrisma(context);
  const admins = await db.user.findMany({
    where: { districtId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  const district = await db.district.findUnique({
    where: { id: districtId },
    select: { name: true },
  });
  return { admins, districtName: district?.name ?? "" };
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
  const me = getOptionalUserFromContext(context);
  if (!me) throw new Response("Unauthorized", { status: 401 });
  const actorIds = getActorIdsFromContext(context);

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!name || !email) return { error: "Name and email are required." };

  const db = getPrisma(context);
  const district = await db.district.findUnique({
    where: { id: districtId },
    select: { name: true },
  });

  const result = await inviteUser(context, {
    request,
    name,
    email,
    role: "ADMIN",
    scope: { kind: "district", id: districtId },
    invitedByUserId: actorIds.actorUserId ?? me.id,
    invitedByOnBehalfOfUserId: actorIds.onBehalfOfUserId,
    invitedByEmail: (me as { email?: string }).email ?? null,
    invitedToLabel: district?.name ?? null,
  });
  if (!result.ok) {
    if (result.error === "user-exists") {
      return { error: "A user with that email already exists." };
    }
    return { error: "Could not invite the user." };
  }

  throw redirect("/district/admins");
}
