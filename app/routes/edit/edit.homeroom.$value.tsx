import { Button, Input } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { MoveRightIcon, Trash2Icon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/edit.homeroom.$value";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { dataWithSuccess, redirectWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export async function loader({ params, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  const teacher = await prisma.teacher.findUnique({
    where: { id: parseInt(params.homeroom) }
  });

  if (!teacher) {
    throw new Error("Teacher not found");
  }

  const [studentsInRoom, otherStudents] = await Promise.all([
    prisma.student.findMany({
      where: { homeRoom: teacher.homeRoom },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
    }),
    prisma.student.findMany({
      where: { OR: [{ homeRoom: { not: teacher.homeRoom } }, { homeRoom: null }] },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
    })
  ]);

  return { success: true, students: studentsInRoom, otherStudents, teacher };
}

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  try {
    const deleteStudentId = formData.get("delete") as string;
    if (deleteStudentId) {
      await prisma.student.update({
        where: { id: parseInt(deleteStudentId) },
        data: { homeRoom: null }
      });
      return dataWithSuccess(t("edit.homeroom.toasts.removed"), {
        message: t("edit.homeroom.toasts.removed"),
      });
    }

    const teacherId = formData.get("id") as string;
    const homeRoom = formData.get("homeRoom") as string;
    const pendingStudentsJson = formData.get("pendingStudents") as string;
    const action = formData.get("action") as string;

    if (homeRoom && teacherId) {
      await prisma.teacher.update({
        where: { id: parseInt(teacherId) },
        data: { homeRoom }
      });
    }

    if (pendingStudentsJson) {
      const pendingStudents = JSON.parse(pendingStudentsJson);
      await Promise.all(
        pendingStudents.map((studentId: number) =>
          prisma.student.update({ where: { id: studentId }, data: { homeRoom } })
        )
      );
    }

    if (action === "done") {
      return redirectWithSuccess("/admin", {
        message: t("edit.homeroom.toasts.updatedSuccess"),
      });
    }

    return dataWithSuccess(t("edit.homeroom.toasts.updated"), {
      message: t("edit.homeroom.toasts.updated"),
    });
  } catch (error) {
    console.error("Error updating homeroom:", error);
    return { error: t("edit.homeroom.errors.updateFailed") };
  }
}

export default function EditHomeroom({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const { students, otherStudents, teacher } = loaderData;
  const { t } = useTranslation("admin");

  const [homeRoom, setHomeRoom] = useState(teacher.homeRoom);
  const [pendingStudents, setPendingStudents] = useState<
    Array<{ id: number; firstName: string; lastName: string; currentHomeRoom?: string }>
  >([]);

  const isSubmitting = fetcher.state === "submitting";

  const handleStudentSelect = (studentData: string) => {
    const parts = studentData.split(" ");
    const studentId = parseInt(parts[parts.length - 1]);
    const student = otherStudents.find((s) => s.id === studentId);
    if (!student) return;
    if (!pendingStudents.find((p) => p.id === studentId)) {
      setPendingStudents((prev) => [...prev, { id: studentId, firstName: parts[0], lastName: parts[1], currentHomeRoom: student.homeRoom || undefined }]);
    }
  };

  const removePendingStudent = (studentId: number) => {
    setPendingStudents((prev) => prev.filter((s) => s.id !== studentId));
  };

  const availableStudents = otherStudents.filter(
    (student) => !pendingStudents.find((p) => p.id === student.id)
  );

  return (
    <Page user={false}>
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">{t("edit.homeroom.heading")}</h1>

        <fetcher.Form method="post" className="space-y-6">
          <input type="hidden" name="id" value={teacher.id} />
          <input type="hidden" name="pendingStudents" value={JSON.stringify(pendingStudents.map((s) => s.id))} />

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("edit.homeroom.teacherInfo")}</h2>
            <label className="text-sm text-gray-400">{t("edit.homeroom.homeroomLabel")}</label>
            <Input name="homeRoom" value={homeRoom} onChange={(e) => setHomeRoom(e.target.value)} required disabled={isSubmitting} />
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("edit.homeroom.currentStudents", { n: students.length })}</h2>
            {students.length === 0 ? (
              <p className="text-white italic">{t("edit.homeroom.noStudents")}</p>
            ) : (
              <div className="space-y-2">
                {students.map((student: any) => (
                  <div key={student.id} className="flex items-center justify-between p-3 bg-gray-500 rounded-lg">
                    <span className="font-medium">{student.firstName} {student.lastName}</span>
                    <Button size="sm" name="delete" variant="danger" value={student.id.toString()} type="submit" isIconOnly isDisabled={isSubmitting}>
                      <Trash2Icon size={16} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("edit.homeroom.addStudents")}</h2>
            {availableStudents.length > 0 ? (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">{t("edit.homeroom.selectLabel")}</label>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      const s = availableStudents.find((s) => s.id === parseInt(e.target.value));
                      if (s) handleStudentSelect(`${s.firstName} ${s.lastName} ${s.id}`);
                      e.target.value = "";
                    }
                  }}
                  disabled={isSubmitting}
                  className="rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 focus:border-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="">{t("edit.homeroom.selectStudent")}</option>
                  {availableStudents.map((student: any) => (
                    <option key={student.id} value={student.id.toString()} className="bg-gray-900 text-gray-100">
                      {student.firstName} {student.lastName}
                      {student.homeRoom
                        ? ` ${t("edit.homeroom.currentlyIn", { room: student.homeRoom })}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-gray-500 italic">{t("edit.homeroom.noAvailable")}</p>
            )}
          </div>

          {pendingStudents.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-orange-400">{t("edit.homeroom.pendingHeading", { n: pendingStudents.length })}</h2>
              {pendingStudents.map((student) => (
                <div key={student.id} className="flex items-center justify-between p-2 bg-white/10 rounded border border-white/20">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{student.firstName} {student.lastName}</span>
                    <MoveRightIcon size={16} className="text-orange-400" />
                    <span className="text-sm text-gray-400">
                      {(student.currentHomeRoom || t("edit.homeroom.noHomeroom"))} → {homeRoom}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" isIconOnly onPress={() => removePendingStudent(student.id)} isDisabled={isSubmitting}>
                    <XIcon size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {fetcher.data?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm">{fetcher.data.error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-6 border-t">
            <Button type="submit" variant="primary" name="action" value="save" isPending={isSubmitting} isDisabled={!homeRoom.trim()}>{t("edit.homeroom.saveChanges")}</Button>
            <Button type="submit" variant="secondary" name="action" value="done" isPending={isSubmitting} isDisabled={!homeRoom.trim()}>{t("edit.homeroom.saveAndReturn")}</Button>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
