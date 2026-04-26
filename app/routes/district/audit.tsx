import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import type { Route } from "./+types/audit";

export async function loader({ context }: Route.LoaderArgs) {
  requireDistrictAdmin(context);
  return null;
}

export default function DistrictAuditStub() {
  return (
    <section>
      <p className="text-sm text-white/50">Audit log (placeholder)</p>
    </section>
  );
}
