import { Form, redirect } from "react-router";
import type { Route } from "./+types/districts.$slug";
import { requirePlatformAdmin } from "~/domain/auth/platform-admin.server";
import { getDistrictBySlug } from "~/domain/district/district.server";
import { getPrisma } from "~/db.server";
import {
  listDistrictAudit,
  writeDistrictAudit,
  type DistrictAuditAction,
} from "~/domain/district/audit.server";
import { getActorIdsFromContext } from "~/domain/utils/global-context.server";
import { formatActorLabel } from "~/domain/auth/format-actor";

export async function loader({ context, params }: Route.LoaderArgs) {
  await requirePlatformAdmin(context);
  const district = await getDistrictBySlug(context, params.slug);
  if (!district) throw new Response("Not found", { status: 404 });
  const audit = await listDistrictAudit(context, district.id, 50);

  // Resolve display labels for the impersonated half of the audit pair.
  // `actorEmail` is already snapshotted on the row; for `onBehalfOfUserId`
  // we look up the email at render time.
  const db = getPrisma(context);
  const onBehalfIds = new Set<string>();
  for (const e of audit as Array<{ onBehalfOfUserId?: string | null }>) {
    if (e.onBehalfOfUserId) onBehalfIds.add(e.onBehalfOfUserId);
  }
  let onBehalfEmailById = new Map<string, string>();
  if (onBehalfIds.size) {
    const users = await db.user.findMany({
      where: { id: { in: Array.from(onBehalfIds) } },
      select: { id: true, email: true },
    });
    onBehalfEmailById = new Map(users.map((u) => [u.id, u.email]));
  }
  const auditWithImpersonator = audit.map((e: any) => ({
    ...e,
    onBehalfOfUserId: e.onBehalfOfUserId ?? null,
    onBehalfOfEmail: e.onBehalfOfUserId
      ? onBehalfEmailById.get(e.onBehalfOfUserId) ?? null
      : null,
  }));

  return { district, audit: auditWithImpersonator } as const;
}

export default function PlatformDistrictDetail({
  loaderData,
}: Route.ComponentProps) {
  const { district, audit } = loaderData;
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{district.name}</h2>
        <p className="text-xs text-white/50">
          Slug: <span className="font-mono">{district.slug}</span> · Status:{" "}
          {district.status}
        </p>
      </div>
      <Form
        method="post"
        className="grid max-w-md gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm"
      >
        <h3 className="font-medium">Contract</h3>
        <label className="block">
          <span className="block text-white/60">School cap</span>
          <input
            name="schoolCap"
            type="number"
            min={1}
            defaultValue={district.schoolCap}
            className="block w-full app-field"
          />
        </label>
        <label className="block">
          <span className="block text-white/60">Trial ends at</span>
          <input
            name="trialEndsAt"
            type="date"
            defaultValue={
              district.trialEndsAt
                ? new Date(district.trialEndsAt).toISOString().slice(0, 10)
                : ""
            }
            className="block w-full app-field"
          />
        </label>
        <label className="block">
          <span className="block text-white/60">Stripe customer ID</span>
          <input
            name="stripeCustomerId"
            defaultValue={district.stripeCustomerId ?? ""}
            className="block w-full app-field font-mono text-xs"
          />
        </label>
        <label className="block">
          <span className="block text-white/60">Comp until</span>
          <input
            name="compedUntil"
            type="date"
            defaultValue={
              district.compedUntil
                ? new Date(district.compedUntil).toISOString().slice(0, 10)
                : ""
            }
            className="block w-full app-field"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isComped"
            defaultChecked={district.isComped}
          />
          Hard-on comp
        </label>
        <label className="block">
          <span className="block text-white/60">Billing note</span>
          <textarea
            name="billingNote"
            defaultValue={district.billingNote ?? ""}
            className="block w-full app-field"
          />
        </label>
        <button
          type="submit"
          className="w-fit rounded-lg bg-[#E9D500] px-3 py-1.5 font-semibold text-[#193B4B] hover:bg-[#f5e047]"
        >
          Save
        </button>
      </Form>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 font-medium">Recent audit (50)</h3>
        <ul className="space-y-1 text-xs">
          {audit.length === 0 ? (
            <li className="text-white/50">No events.</li>
          ) : null}
          {audit.map((e) => {
            const actorLabel = e.actorEmail ?? null;
            const onBehalfLabel = e.onBehalfOfEmail ?? e.onBehalfOfUserId ?? null;
            const fullLabel = formatActorLabel(actorLabel, onBehalfLabel, "—");
            return (
              <li key={e.id} className="text-white/70" aria-label={fullLabel}>
                <span className="text-white/40">
                  {new Date(e.createdAt).toISOString()}
                </span>{" "}
                · <span className="font-mono">{e.action}</span> ·{" "}
                <span>{actorLabel ?? fullLabel}</span>
                {onBehalfLabel && actorLabel ? (
                  <span className="ml-1 inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                    <span className="uppercase tracking-wide">via</span>
                    <span>{onBehalfLabel}</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function parseDateOrNull(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const actor = await requirePlatformAdmin(context);
  const actorIds = getActorIdsFromContext(context);
  const district = await getDistrictBySlug(context, params.slug);
  if (!district) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const db = getPrisma(context);

  const newSchoolCap = Number(form.get("schoolCap"));
  const newTrialEndsAt = parseDateOrNull(String(form.get("trialEndsAt") ?? ""));
  const newStripeId =
    String(form.get("stripeCustomerId") ?? "").trim() || null;
  const newCompedUntil = parseDateOrNull(String(form.get("compedUntil") ?? ""));
  const newIsComped = form.get("isComped") === "on";
  const newBillingNote =
    String(form.get("billingNote") ?? "").trim() || null;

  const updates: Record<string, unknown> = {};
  const audits: Array<{
    action: DistrictAuditAction;
    details: Record<string, unknown>;
  }> = [];

  if (Number.isFinite(newSchoolCap) && newSchoolCap !== district.schoolCap) {
    updates.schoolCap = newSchoolCap;
    audits.push({
      action: "district.schoolCap.changed",
      details: { from: district.schoolCap, to: newSchoolCap },
    });
  }
  if ((newTrialEndsAt?.getTime() ?? null) !== (district.trialEndsAt?.getTime() ?? null)) {
    updates.trialEndsAt = newTrialEndsAt;
    audits.push({
      action: "district.trialEndsAt.changed",
      details: {
        from: district.trialEndsAt?.toISOString() ?? null,
        to: newTrialEndsAt?.toISOString() ?? null,
      },
    });
  }
  if (newStripeId !== district.stripeCustomerId) {
    updates.stripeCustomerId = newStripeId;
    audits.push({
      action: "district.stripe.changed",
      details: { from: district.stripeCustomerId, to: newStripeId },
    });
  }
  if (
    (newCompedUntil?.getTime() ?? null) !==
      (district.compedUntil?.getTime() ?? null) ||
    newIsComped !== district.isComped
  ) {
    updates.compedUntil = newCompedUntil;
    updates.isComped = newIsComped;
    audits.push({
      action: "district.comp.changed",
      details: {
        compedUntil: newCompedUntil?.toISOString() ?? null,
        isComped: newIsComped,
      },
    });
  }
  if (newBillingNote !== district.billingNote) {
    updates.billingNote = newBillingNote;
    audits.push({
      action: "district.billing.note.changed",
      details: { from: district.billingNote, to: newBillingNote },
    });
  }

  if (Object.keys(updates).length > 0) {
    await db.district.update({
      where: { id: district.id },
      data: updates,
    });
  }
  for (const a of audits) {
    await writeDistrictAudit(context, {
      districtId: district.id,
      actorUserId: actorIds.actorUserId ?? actor.id,
      onBehalfOfUserId: actorIds.onBehalfOfUserId,
      actorEmail: (actor as { email?: string }).email ?? null,
      action: a.action,
      details: a.details,
    });
  }
  throw redirect(`/platform/districts/${district.slug}`);
}
