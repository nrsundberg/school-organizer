import { Form } from "react-router";

/**
 * Persistent banner shown whenever the current session has
 * `session.impersonatedOrgId` set — i.e. a district admin is acting as a
 * school admin in one of their schools. Distinct from the better-auth
 * `ImpersonationBanner` (platform-admin → user impersonation).
 */
export function DistrictImpersonationBanner({
  active,
  orgName,
}: {
  active: boolean;
  orgName: string | null;
}) {
  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>
        You are impersonating
        {orgName ? (
          <>
            {" "}
            as admin of <strong>{orgName}</strong>
          </>
        ) : null}
        .
      </span>
      <Form method="post" action="/district/impersonate/end">
        <button
          type="submit"
          className="rounded border border-amber-500 px-2 py-0.5 text-xs font-medium hover:bg-amber-200"
        >
          End impersonation
        </button>
      </Form>
    </div>
  );
}
