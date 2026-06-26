import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, GraduationCap, Mail, UserPlus, X } from "lucide-react";
import { dataWithError, dataWithSuccess } from "remix-toast";
import type { Route } from "./+types/classrooms.$classroomId";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import {
  getActorIdsFromContext,
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import { auditOrgAction } from "~/domain/org/audit.server";
import { inviteUser } from "~/domain/admin-users/invite-user.server";
import { GRADE_LEVELS, gradeLabel, isGradeLevel, type GradeLevel } from "~/domain/children/grade";
import { getAdminT } from "~/lib/t.server";
import { btnPrimary, btnSecondary } from "~/lib/button-classes";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data?.metaTitle ?? "Classroom — Admin" },
];

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);

  const classroomId = Number(params.classroomId);
  if (!Number.isInteger(classroomId)) {
    throw new Response("Not found", { status: 404 });
  }

  // Teacher is a tenant model, so this is org-scoped automatically.
  const classroom = await prisma.teacher.findFirst({
    where: { id: classroomId },
    select: {
      id: true,
      homeRoom: true,
      gradeLevel: true,
      capacity: true,
      teacherName: true,
      userId: true,
    },
  });
  if (!classroom) {
    throw new Response("Not found", { status: 404 });
  }

  // User is NOT tenant-scoped — filter orgId explicitly on every query below.
  const [linkedUser, roster, teacherUsers] = await Promise.all([
    classroom.userId
      ? prisma.user.findFirst({
          where: { id: classroom.userId, orgId: org.id },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve(null),
    prisma.student.findMany({
      where: { homeRoom: classroom.homeRoom },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.user.findMany({
      where: { orgId: org.id, role: "TEACHER" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const t = await getAdminT(request, context);
  return {
    classroom,
    linkedUser,
    roster,
    teacherUsers,
    metaTitle: t("classroomDetail.metaTitle", { name: classroom.homeRoom }),
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const me = await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const actor = getActorIdsFromContext(context);
  const t = await getAdminT(request, context);

  const classroomId = Number(params.classroomId);
  if (!Number.isInteger(classroomId)) {
    return dataWithError(null, t("classroomDetail.errors.notFound"));
  }
  // Confirm the classroom belongs to this org before any write.
  const classroom = await prisma.teacher.findFirst({
    where: { id: classroomId },
    select: { id: true, homeRoom: true, teacherName: true, userId: true },
  });
  if (!classroom) {
    return dataWithError(null, t("classroomDetail.errors.notFound"));
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "assignExisting") {
      const userId = String(formData.get("userId") ?? "");
      // The selected user must be a TEACHER in THIS org (User is not
      // tenant-scoped, so check orgId explicitly).
      const user = await prisma.user.findFirst({
        where: { id: userId, orgId: org.id, role: "TEACHER" },
        select: { id: true, name: true },
      });
      if (!user) {
        return dataWithError(null, t("classroomDetail.errors.invalidTeacher"));
      }
      await prisma.teacher.update({
        where: { id: classroomId },
        data: { userId: user.id, teacherName: user.name || classroom.teacherName },
      });
      await auditOrgAction(context, request, {
        action: "classroom.update",
        targetType: "classroom",
        targetId: String(classroomId),
        before: { userId: classroom.userId },
        after: { userId: user.id },
        keys: ["userId"],
      });
      return dataWithSuccess(null, t("classroomDetail.toasts.teacherAssigned"));
    }

    if (intent === "inviteTeacher") {
      const email = String(formData.get("email") ?? "").trim();
      const name = String(formData.get("name") ?? "").trim();
      const result = await inviteUser(context, {
        request,
        email,
        name,
        role: "TEACHER",
        scope: { kind: "org", id: org.id },
        invitedByUserId: actor.actorUserId ?? me.id,
        invitedByOnBehalfOfUserId: actor.onBehalfOfUserId,
        invitedByEmail: (me as { email?: string }).email ?? null,
        invitedToLabel: org.name,
      });
      if (!result.ok) {
        const key =
          result.error === "user-exists"
            ? "classroomDetail.errors.userExists"
            : result.error === "invalid-email"
              ? "classroomDetail.errors.invalidEmail"
              : result.error === "invalid-name"
                ? "classroomDetail.errors.invalidName"
                : "classroomDetail.errors.inviteFailed";
        return dataWithError(null, t(key));
      }
      await prisma.teacher.update({
        where: { id: classroomId },
        data: { userId: result.userId, teacherName: name },
      });
      await auditOrgAction(context, request, {
        action: "classroom.update",
        targetType: "classroom",
        targetId: String(classroomId),
        before: { userId: classroom.userId },
        after: { userId: result.userId },
        keys: ["userId"],
      });
      return dataWithSuccess(null, t("classroomDetail.toasts.teacherInvited", { email }));
    }

    if (intent === "unlinkTeacher") {
      await prisma.teacher.update({
        where: { id: classroomId },
        data: { userId: null },
      });
      await auditOrgAction(context, request, {
        action: "classroom.update",
        targetType: "classroom",
        targetId: String(classroomId),
        before: { userId: classroom.userId },
        after: { userId: null },
        keys: ["userId"],
      });
      return dataWithSuccess(null, t("classroomDetail.toasts.teacherUnlinked"));
    }

    if (intent === "updateDetails") {
      const grade = String(formData.get("grade") ?? "");
      if (grade && !isGradeLevel(grade)) {
        return dataWithError(null, t("children.classroomActions.invalidGrade"));
      }
      const capacityRaw = String(formData.get("capacity") ?? "").trim();
      const capacity = capacityRaw === "" ? null : Number(capacityRaw);
      if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 200)) {
        return dataWithError(null, t("classroomDetail.errors.invalidCapacity"));
      }
      await prisma.teacher.update({
        where: { id: classroomId },
        data: {
          gradeLevel: grade ? (grade as GradeLevel) : null,
          capacity,
        },
      });
      return dataWithSuccess(null, t("classroomDetail.toasts.detailsSaved"));
    }
  } catch (error) {
    console.error("[classrooms.$classroomId] action failed", error);
    return dataWithError(
      null,
      error instanceof Error ? error.message : t("children.classroomActions.updateFailed"),
    );
  }

  // After a redirect-free success the loader revalidates automatically; an
  // unknown intent is a programming error.
  return dataWithError(null, t("children.classroomActions.unknownAction"));
}

export default function ClassroomDetail({ loaderData }: Route.ComponentProps) {
  const { classroom, linkedUser, roster, teacherUsers } = loaderData;
  const { t } = useTranslation("admin");

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl">
      <div>
        <Link
          to="/admin/classrooms"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("classroomDetail.back")}
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <GraduationCap className="w-8 h-8 text-blue-400 flex-shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-white">{classroom.homeRoom}</h1>
            <p className="text-white/50 text-sm">
              {t("classroomDetail.studentCount", { count: roster.length })}
            </p>
          </div>
        </div>
      </div>

      {/* Teacher */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-white">{t("classroomDetail.teacher.heading")}</h2>

        {linkedUser ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {linkedUser.name || classroom.teacherName || classroom.homeRoom}
              </p>
              <p className="text-xs text-white/50 truncate">{linkedUser.email}</p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="unlinkTeacher" />
              <button type="submit" className={`${btnSecondary} text-xs`}>
                <X className="w-3.5 h-3.5 mr-1 inline" />
                {t("classroomDetail.teacher.unlink")}
              </button>
            </Form>
          </div>
        ) : (
          <p className="text-sm text-white/50">
            {classroom.teacherName
              ? t("classroomDetail.teacher.unlinkedNamed", { name: classroom.teacherName })
              : t("classroomDetail.teacher.none")}
          </p>
        )}

        {/* Assign an existing teacher account */}
        {teacherUsers.length > 0 ? (
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="assignExisting" />
            <label className="flex flex-col gap-1 text-sm text-white/60 flex-1 min-w-[200px]">
              {t("classroomDetail.teacher.assignExisting")}
              <select name="userId" required className="app-field" defaultValue="">
                <option value="" disabled>
                  {t("classroomDetail.teacher.selectPlaceholder")}
                </option>
                {teacherUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ? `${u.name} (${u.email})` : u.email}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={btnSecondary}>
              {t("classroomDetail.teacher.assignButton")}
            </button>
          </Form>
        ) : null}

        {/* Invite a brand-new teacher (creates a TEACHER user) */}
        <Form method="post" className="flex flex-col gap-2 border-t border-white/10 pt-4">
          <input type="hidden" name="intent" value="inviteTeacher" />
          <p className="text-sm font-medium text-white inline-flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" />
            {t("classroomDetail.teacher.inviteHeading")}
          </p>
          <p className="text-xs text-white/50">{t("classroomDetail.teacher.inviteHelp")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm text-white/60 flex-1 min-w-[160px]">
              {t("classroomDetail.teacher.nameLabel")}
              <input name="name" type="text" required className="app-field" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-white/60 flex-1 min-w-[200px]">
              {t("classroomDetail.teacher.emailLabel")}
              <input name="email" type="email" required className="app-field" />
            </label>
            <button type="submit" className={btnPrimary}>
              <Mail className="w-4 h-4 mr-1.5 inline" />
              {t("classroomDetail.teacher.inviteButton")}
            </button>
          </div>
        </Form>
      </section>

      {/* Classroom details */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">
          {t("classroomDetail.details.heading")}
        </h2>
        <Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="updateDetails" />
          <label className="flex flex-col gap-1 text-sm text-white/60">
            {t("classroomDetail.details.grade")}
            <select
              name="grade"
              defaultValue={classroom.gradeLevel ?? ""}
              className="app-field"
            >
              <option value="">{t("children.card.ungraded")}</option>
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-white/60">
            {t("classroomDetail.details.capacity")}
            <input
              name="capacity"
              type="number"
              min={1}
              max={200}
              defaultValue={classroom.capacity ?? ""}
              className="app-field w-28"
            />
          </label>
          <button type="submit" className={btnSecondary}>
            {t("classroomDetail.details.save")}
          </button>
        </Form>
      </section>

      {/* Roster */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">
          {t("classroomDetail.roster.heading")}
        </h2>
        {roster.length === 0 ? (
          <p className="text-sm text-white/40">{t("classroomDetail.roster.empty")}</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {roster.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/admin/students/${s.id}`}
                  className="block rounded-md px-2 py-1 text-sm text-white/80 hover:bg-white/5 hover:text-white"
                >
                  {s.lastName}, {s.firstName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
