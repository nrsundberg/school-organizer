import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import type { Route } from "./+types/districts";

export async function loader({ context }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  return null;
}

export default function PlatformDistrictsStub() {
  return (
    <section>
      <p className="text-sm text-white/50">Districts (placeholder)</p>
    </section>
  );
}
