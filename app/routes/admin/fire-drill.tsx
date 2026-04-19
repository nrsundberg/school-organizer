import { Form, Link, redirect } from "react-router";
import { Button } from "@heroui/react";
import { ClipboardList } from "lucide-react";
import type { Route } from "./+types/fire-drill";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { defaultTemplateDefinition } from "~/domain/fire-drill/types";
import { dataWithError, dataWithSuccess } from "remix-toast";

export const meta: Route.MetaFunction = () => [{ title: "Admin – Fire drill checklists" }];

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const templates = await prisma.fireDrillTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });
  return { templates };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return dataWithError(null, "Name is required.");
    }
    const orgId = getOrgFromContext(context).id;
    const created = await prisma.fireDrillTemplate.create({
      data: {
        orgId,
        name,
        definition: defaultTemplateDefinition() as object,
      },
    });
    throw redirect(`/admin/fire-drill/${created.id}`);
  }

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) {
      return dataWithError(null, "Missing template id.");
    }
    await prisma.fireDrillTemplate.delete({ where: { id } });
    return dataWithSuccess(null, "Checklist deleted.");
  }

  return dataWithError(null, "Unknown action.");
}

export default function AdminFireDrillList({ loaderData }: Route.ComponentProps) {
  const { templates } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <ClipboardList className="w-8 h-8 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <h1 className="text-2xl font-bold text-white">Fire drill checklists</h1>
          <p className="text-white/50 text-sm mt-1">
            Build per-organization templates, run them during a drill, and print when needed.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white/70 mb-3">New checklist template</h2>
        <Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="intent" value="create" />
          <label className="text-sm text-white/60 flex flex-col gap-1 flex-1 min-w-[200px]">
            Name
            <input
              name="name"
              type="text"
              required
              placeholder="e.g. Fire drill, Lockdown"
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white"
            />
          </label>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </Form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white/70 mb-3">Your templates</h2>
        {templates.length === 0 ? (
          <p className="text-white/40 text-sm">No templates yet. Create one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <Link
                    to={`/admin/fire-drill/${t.id}`}
                    className="font-medium text-white hover:text-blue-300 transition-colors"
                  >
                    {t.name}
                  </Link>
                  <p className="text-xs text-white/40 mt-0.5">
                    Updated {new Date(t.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/admin/fire-drill/${t.id}/run`}
                    className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    Run
                  </Link>
                  <Link
                    to={`/admin/fire-drill/${t.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                  >
                    Edit layout
                  </Link>
                  <Form method="post" onSubmit={(e) => !confirm("Delete this template?") && e.preventDefault()}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={t.id} />
                    <Button type="submit" variant="ghost" size="sm" className="text-rose-300">
                      Delete
                    </Button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
