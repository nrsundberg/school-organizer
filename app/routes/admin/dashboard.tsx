import { Form, Link, useFetcher } from "react-router";
import { Button } from "@heroui/react";
import { Status } from "~/db/browser";
import { protectToAdminAndGetPermissions, requireRole } from "~/sessions.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { buildUsageSnapshot, countOrgUsage, type UsageSnapshot } from "~/domain/billing/plan-usage.server";
import { useState } from "react";
import { MinimalCsvFileChooser } from "~/components/FileChooser";
import type { Route } from "./+types/dashboard";
import { dataWithError, dataWithInfo, dataWithSuccess, dataWithWarning } from "remix-toast";
import { broadcastBoardReset } from "~/lib/broadcast.server";

export const meta: Route.MetaFunction = () => [{ title: "Admin Dashboard" }];

export async function loader({ context }: Route.LoaderArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const org = getOrgFromContext(context);
  const prisma = getTenantPrisma(context);
  const [studentCount, spaceCount, appSettings, maxSpace, teachers, counts] = await Promise.all([
    prisma.student.count(),
    prisma.space.count(),
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    prisma.space.aggregate({ _max: { spaceNumber: true } }),
    prisma.teacher.findMany({ orderBy: { homeRoom: "asc" } }),
    countOrgUsage(prisma, org.id),
  ]);
  const usage = buildUsageSnapshot(org, counts, new Date());
  return {
    studentCount,
    spaceCount,
    viewerDrawingEnabled: appSettings?.viewerDrawingEnabled ?? false,
    isAdmin: me.role === "ADMIN",
    maxSpaceNumber: maxSpace._max.spaceNumber ?? 0,
    teachers,
    usage,
    billingPlan: org.billingPlan,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const raw = formData.get("gridSize") as string;
    const gridSize = Math.min(5000, Math.max(1, parseInt(raw || "300", 10) || 300));
    const data = [];
    for (let i = 1; i <= gridSize; i++) {
      data.push({ spaceNumber: i, status: Status.EMPTY });
    }
    await prisma.space.deleteMany();
    for (let i = 0; i < data.length; i += 50) {
      await prisma.space.createMany({ data: data.slice(i, i + 50) });
    }
    return dataWithSuccess(null, `Created grid (${gridSize} spaces)`);
  }

  if (action === "extendGrid") {
    const target = Math.min(
      5000,
      Math.max(1, parseInt((formData.get("extendTo") as string) || "0", 10)),
    );
    const maxRow = await prisma.space.aggregate({ _max: { spaceNumber: true } });
    const currentMax = maxRow._max.spaceNumber ?? 0;
    if (target <= currentMax) {
      return dataWithError(null, "Target must be greater than current max space number.");
    }
    const batch = [];
    for (let i = currentMax + 1; i <= target; i++) {
      batch.push({ spaceNumber: i, status: Status.EMPTY });
    }
    for (let i = 0; i < batch.length; i += 50) {
      await prisma.space.createMany({ data: batch.slice(i, i + 50) });
    }
    return dataWithSuccess(null, `Added spaces ${currentMax + 1}–${target}`);
  }

  if (action === "reduceGrid") {
    const target = Math.min(
      5000,
      Math.max(1, parseInt((formData.get("reduceTo") as string) || "0", 10)),
    );
    const maxRow = await prisma.space.aggregate({ _max: { spaceNumber: true } });
    const currentMax = maxRow._max.spaceNumber ?? 0;
    if (target >= currentMax) {
      return dataWithError(null, "Reduce target must be lower than current max space number.");
    }

    // Keep students, but detach them from spaces that are being removed.
    await prisma.student.updateMany({
      where: { spaceNumber: { gt: target } },
      data: { spaceNumber: null },
    });

    await prisma.space.deleteMany({
      where: { spaceNumber: { gt: target } },
    });

    return dataWithSuccess(null, `Reduced grid to spaces 1–${target}`);
  }

  if (action === "toggleViewerDrawing") {
    await requireRole(context, "ADMIN");
    const enabled = formData.get("enabled") === "true";
    await prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default", viewerDrawingEnabled: enabled },
      update: { viewerDrawingEnabled: enabled },
    });
    return dataWithSuccess(null, enabled ? "Viewer drawing enabled" : "Viewer drawing disabled");
  }

  if (action === "clear") {
    await prisma.$transaction([
      prisma.space.updateMany({ data: { status: Status.EMPTY, timestamp: null } }),
      prisma.callEvent.deleteMany(),
    ]);
    try {
      await broadcastBoardReset((context as any).cloudflare.env);
    } catch {
      // Broadcast failure should not break the action
    }
    return dataWithInfo(null, "Reset grid!");
  }

  if (action === "deleteStudents") {
    await prisma.student.deleteMany();
    return dataWithWarning(null, "Deleted all student records");
  }

  return dataWithError(null, "Unknown action");
}

function usageBarColor(ratio: number): string {
  if (ratio >= 1) return "bg-red-500/70";
  if (ratio >= 0.8) return "bg-amber-400/70";
  return "bg-white/10";
}

function PlanUsagePanel({
  usage,
  billingPlan,
}: {
  usage: UsageSnapshot;
  billingPlan: string;
}) {
  const isAtOrNearLimit =
    usage.worstLevel === "over_cap" ||
    usage.worstLevel === "grace" ||
    usage.worstLevel === "grace_expired";

  const dims: { key: "students" | "families" | "classrooms"; label: string }[] = [
    { key: "students", label: "Students" },
    { key: "families", label: "Families" },
    { key: "classrooms", label: "Classrooms" },
  ];

  return (
    <section className="rounded-xl bg-white/5 border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold text-base">Plan usage</h2>
          <p className="text-white/50 text-xs mt-0.5">
            Plan: <span className="text-white">{billingPlan}</span>
            {" · "}
            <Link to="/admin/billing" className="text-blue-400 hover:underline">
              Manage billing
            </Link>
          </p>
        </div>
        {isAtOrNearLimit && (
          <p className="text-sm text-amber-300 text-right max-w-xs">
            You&apos;re at or near your plan limit.{" "}
            <Link to="/admin/billing" className="underline hover:text-amber-200">
              View billing
            </Link>
          </p>
        )}
      </div>
      {usage.limits ? (
        <div className="flex flex-col gap-4">
          {dims.map(({ key, label }) => {
            const count = usage.counts[key];
            const cap = usage.limits![key];
            const ratio = cap > 0 ? count / cap : 0;
            const pct = Math.min(100, Math.round(ratio * 100));
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                  <span>{label}</span>
                  <span>
                    {count} / {cap}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${usageBarColor(ratio)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-white/50 text-sm">Enterprise plan — no usage limits apply.</p>
      )}
    </section>
  );
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const {
    studentCount,
    spaceCount,
    viewerDrawingEnabled,
    isAdmin,
    maxSpaceNumber,
    teachers,
    usage,
    billingPlan,
  } = loaderData;
  const fetcher = useFetcher();
  const deleteFetcher = useFetcher({ key: "deleteStudents" });
  const settingsFetcher = useFetcher({ key: "viewerDrawing" });
  const [file, setFile] = useState<File | null>(null);
  const [gridSize, setGridSize] = useState("300");
  const [extendTo, setExtendTo] = useState("");
  const [reduceTo, setReduceTo] = useState("");
  const hasExistingGrid = spaceCount > 0;

  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <p className="text-white/50 text-sm">Students</p>
          <p className="text-3xl font-bold text-white">{studentCount}</p>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <p className="text-white/50 text-sm">Grid Spaces</p>
          <p className="text-3xl font-bold text-white">{spaceCount}</p>
        </div>
      </div>

      {/* Plan usage */}
      <PlanUsagePanel usage={usage} billingPlan={billingPlan} />

      {/* Grid Controls */}
      <section>
        <h2 className="text-white font-semibold text-base mb-3">Grid Controls</h2>
        <p className="text-white/50 text-sm mb-2">
          Max space number: <span className="text-white font-mono">{maxSpaceNumber}</span> ({spaceCount}{" "}
          spaces)
        </p>
        <Form method="post" className="flex flex-col gap-3 max-w-md">
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-sm text-white/60 flex flex-col gap-1">
              Spaces for new grid (1–5000)
              <input
                name="gridSize"
                type="number"
                min={1}
                max={5000}
                value={gridSize}
                onChange={(e) => setGridSize(e.target.value)}
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white w-32 disabled:opacity-50"
                disabled={hasExistingGrid}
              />
            </label>
            <Button variant="primary" type="submit" value="create" name="action" isDisabled={hasExistingGrid}>
              Create Grid
            </Button>
            <Button variant="secondary" type="submit" value="clear" name="action">
              Clear Grid
            </Button>
          </div>
          <p className="text-xs text-amber-200/80">
            {hasExistingGrid
              ? "Create Grid is disabled because a grid already exists. Use Extend or Reduce."
              : "Create Grid builds spaces 1..N for initial setup."}
          </p>
        </Form>
        <Form method="post" className="flex flex-wrap gap-3 items-end mt-4 max-w-md">
          <input type="hidden" name="action" value="extendGrid" />
          <label className="text-sm text-white/60 flex flex-col gap-1">
            Extend to space #
            <input
              name="extendTo"
              type="number"
              min={1}
              max={5000}
              placeholder={`e.g. ${Math.max(maxSpaceNumber + 50, 350)}`}
              value={extendTo}
              onChange={(e) => setExtendTo(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white w-36"
            />
          </label>
          <Button variant="secondary" type="submit">
            Add Spaces
          </Button>
        </Form>
        <Form method="post" className="flex flex-wrap gap-3 items-end mt-3 max-w-md">
          <input type="hidden" name="action" value="reduceGrid" />
          <label className="text-sm text-white/60 flex flex-col gap-1">
            Reduce to space #
            <input
              name="reduceTo"
              type="number"
              min={1}
              max={5000}
              placeholder={`e.g. ${Math.max(maxSpaceNumber - 5, 1)}`}
              value={reduceTo}
              onChange={(e) => setReduceTo(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white w-36"
            />
          </label>
          <Button variant="danger" type="submit">
            Reduce Grid
          </Button>
          <p className="w-full text-xs text-amber-200/80">
            Students assigned above the new max are kept and automatically detached from their space number.
          </p>
        </Form>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-white font-semibold text-base">Viewer board drawing</h2>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              viewerDrawingEnabled
                ? "bg-green-500/20 text-green-300"
                : "bg-white/10 text-white/70"
            }`}
          >
            {viewerDrawingEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <p className="text-white/50 text-sm mb-2">
          When enabled, viewers can draw light lines on the public board (stored on their device only).
        </p>
        <p className="text-white/40 text-xs mb-3">
          This affects the board seen by viewer accounts and logged-out visitors on the home page.
        </p>
        {isAdmin ? (
          <settingsFetcher.Form method="post" className="flex items-center gap-3">
            <input type="hidden" name="action" value="toggleViewerDrawing" />
            <input type="hidden" name="enabled" value={viewerDrawingEnabled ? "false" : "true"} />
            <Button
              type="submit"
              variant={viewerDrawingEnabled ? "danger" : "primary"}
              isPending={settingsFetcher.state !== "idle"}
            >
              {viewerDrawingEnabled ? "Disable drawing" : "Enable drawing"}
            </Button>
          </settingsFetcher.Form>
        ) : (
          <p className="text-sm text-amber-200/80">
            Only admins can change this setting. Ask an admin to enable or disable viewer drawing.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-white font-semibold text-base mb-3">Print backups (PDF)</h2>
        <p className="text-white/50 text-sm mb-3">Opens in the browser for preview and printing.</p>
        <div className="flex flex-col gap-2 text-sm">
          <div>
            <p className="text-white/70 mb-1">Full board grid</p>
            <div className="flex gap-3 text-sm">
              <a
                className="text-blue-400 hover:underline"
                href="/admin/print/board?fit=page"
                target="_blank"
                rel="noreferrer"
              >
                Fit to one page
              </a>
              <span className="text-white/30">·</span>
              <a
                className="text-blue-400 hover:underline"
                href="/admin/print/board?fit=grow"
                target="_blank"
                rel="noreferrer"
              >
                Natural size (may span pages)
              </a>
            </div>
          </div>
          <a
            className="text-blue-400 hover:underline"
            href="/admin/print/master"
            target="_blank"
            rel="noreferrer"
          >
            Master list — all students by car space + homeroom
          </a>
          {teachers.length > 0 && (
            <div className="mt-2">
              <p className="text-white/50 mb-1">Per homeroom</p>
              <ul className="list-disc list-inside space-y-1 text-white/80 max-h-48 overflow-y-auto">
                {teachers.map((t) => (
                  <li key={t.id}>
                    <span className="text-white">{t.homeRoom}</span> —{" "}
                    <a className="text-blue-400 hover:underline" href={`/admin/print/homeroom/${t.id}?sort=name`} target="_blank" rel="noreferrer">
                      A–Z
                    </a>
                    {" · "}
                    <a className="text-blue-400 hover:underline" href={`/admin/print/homeroom/${t.id}?sort=space`} target="_blank" rel="noreferrer">
                      By space #
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* CSV Import */}
      <section>
        <h2 className="text-white font-semibold text-base mb-3">Import Students</h2>
        <fetcher.Form encType="multipart/form-data" action="/data/students" method="post" className="flex flex-col gap-2">
          <MinimalCsvFileChooser file={file} setFile={setFile} />
          <Button
            type="submit"
            variant="primary"
            isDisabled={file === null || fetcher.state !== "idle"}
            className="self-start mt-1"
          >
            Create Records
          </Button>
        </fetcher.Form>
      </section>

      {/* Danger zone */}
      <section>
        <h2 className="text-white font-semibold text-base mb-3">Danger Zone</h2>
        <Button
          variant="danger"
          onPress={() => deleteFetcher.submit({ action: "deleteStudents" }, { method: "post" })}
          isDisabled={studentCount === 0 || deleteFetcher.state !== "idle"}
        >
          Delete All Student Records
        </Button>
      </section>
    </div>
  );
}
