import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import type { Route } from "./+types/districts.$slug";

export async function loader({ context, params }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  void params;
  return null;
}

export default function PlatformDistrictDetailStub() {
  return (
    <section>
      <p className="text-sm text-white/50">District detail (placeholder)</p>
    </section>
  );
}
