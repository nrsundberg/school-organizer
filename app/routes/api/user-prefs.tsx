import { data } from "react-router";
import type { Route } from "./+types/user-prefs";
import { getPrisma } from "~/db.server";
import { getOptionalUserFromContext } from "~/domain/utils/global-context.server";

export async function action({ request, context }: Route.ActionArgs) {
  const user = getOptionalUserFromContext(context);
  if (!user || user.role !== "CONTROLLER") {
    return data({ error: "Unauthorized" }, { status: 403 });
  }
  const formData = await request.formData();
  const view = formData.get("controllerViewPreference") as string;
  if (view !== "board" && view !== "controller") {
    return data({ error: "Invalid preference" }, { status: 400 });
  }
  await getPrisma(context).user.update({
    where: { id: user.id },
    data: { controllerViewPreference: view },
  });
  return data({ ok: true });
}
