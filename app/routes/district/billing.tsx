import { requireDistrictAdmin } from "~/domain/district/route-guard.server";
import type { Route } from "./+types/billing";

export async function loader({ context }: Route.LoaderArgs) {
  requireDistrictAdmin(context);
  return null;
}

export default function DistrictBillingStub() {
  return (
    <section>
      <p className="text-sm text-white/50">Billing (placeholder)</p>
    </section>
  );
}
