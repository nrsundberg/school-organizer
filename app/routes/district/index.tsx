import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import type { Route } from "./+types/index";

export async function loader({ context }: Route.LoaderArgs) {
  requireDistrictAdmin(context);
  return null;
}

export default function DistrictDashboardStub() {
  return (
    <section>
      <p className="text-sm text-white/50">Dashboard (placeholder)</p>
    </section>
  );
}
