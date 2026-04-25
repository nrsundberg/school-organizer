import type { Route } from "./+types/roster-template.csv";
import { ROSTER_IMPORT_TEMPLATE_CSV } from "~/domain/csv/roster-import.server";
import { protectToAdminAndGetPermissions } from "~/sessions.server";

export async function loader({ context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);

  return new Response(ROSTER_IMPORT_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pickup-roster-template.csv"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
