import { Button, Input } from "@heroui/react";
import { Form, redirect } from "react-router";
import type { Route } from "./+types/schools.new";
import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import {
  computeCapState,
  getDistrictById,
  getDistrictSchoolCount,
} from "~/domain/district/district.server";
import { provisionSchoolForDistrict } from "~/domain/district/provision-school.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function loader({ context }: Route.LoaderArgs) {
  const districtId = requireDistrictAdmin(context);
  const [district, schoolCount] = await Promise.all([
    getDistrictById(context, districtId),
    getDistrictSchoolCount(context, districtId),
  ]);
  if (!district) throw new Response("District not found", { status: 404 });
  return { cap: computeCapState(schoolCount, district.schoolCap) };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-white/80">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-white/50">{hint}</span> : null}
    </label>
  );
}

export default function NewSchool({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { cap } = loaderData;
  const error = (actionData as { error?: string } | undefined)?.error;
  return (
    <section className="max-w-md space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Add a school</h2>
        <p className="text-sm text-white/50">
          We&rsquo;ll create the school and the admin account. The admin can
          sign in via /forgot-password to set their password.
        </p>
      </div>
      {cap.state === "over" || cap.state === "at" ? (
        <div className="rounded border border-amber-300 bg-amber-500/10 p-3 text-xs text-amber-200">
          You&rsquo;re {cap.state === "over" ? `${cap.over} over` : "at"} your
          contracted school cap of {cap.cap}. The school will still be
          created — your account manager will follow up.
        </div>
      ) : null}
      <Form method="post" className="space-y-3">
        <Field label="School name">
          <Input name="schoolName" required />
        </Field>
        <Field
          label="URL slug"
          hint="lowercase letters, numbers, and dashes (e.g. central-elementary)"
        >
          <Input name="schoolSlug" required />
        </Field>
        <Field label="Admin name">
          <Input name="adminName" required />
        </Field>
        <Field label="Admin email">
          <Input name="adminEmail" type="email" required />
        </Field>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button
          type="submit"
          variant="primary"
          className="bg-[#E9D500] font-semibold text-[#193B4B]"
        >
          Create school
        </Button>
      </Form>
    </section>
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const districtId = requireDistrictAdmin(context);
  const district = await getDistrictById(context, districtId);
  if (!district) throw new Response("District not found", { status: 404 });
  const user = getOptionalUserFromContext(context);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  try {
    await provisionSchoolForDistrict(context, {
      district,
      actor: {
        id: user.id,
        email: (user as { email?: string }).email ?? null,
      },
      input: {
        schoolName: String(form.get("schoolName") ?? ""),
        schoolSlug: String(form.get("schoolSlug") ?? ""),
        adminEmail: String(form.get("adminEmail") ?? ""),
        adminName: String(form.get("adminName") ?? ""),
      },
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create school.",
    };
  }
  throw redirect("/district/schools");
}
