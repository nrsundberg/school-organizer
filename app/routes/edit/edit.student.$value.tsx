import { Button, Input } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { SaveIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/edit.student.$value";
import { countOrgUsage, syncUsageGracePeriod } from "~/domain/billing/plan-usage.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { redirectWithInfo, redirectWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export async function loader({ params, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  let [student, homerooms] = await Promise.all([
    prisma.student.findFirst({
      where: { id: parseInt(params.student) },
      include: { space: true, teacher: true }
    }),
    prisma.teacher.findMany({ orderBy: { homeRoom: "asc" } })
  ]);

  if (!student) {
    throw new Error("Student not found");
  }

  return { student, homerooms };
}

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();
  const action = formData.get("action") as string;
  const id = formData.get("id") as string;

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  if (!id || isNaN(parseInt(id))) {
    throw new Error(t("edit.student.errors.invalidId"));
  }

  try {
    if (action === "delete") {
      await prisma.student.delete({ where: { id: parseInt(id) } });
      const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
      if (freshOrg) {
        const nextCounts = await countOrgUsage(prisma, org.id);
        await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
      }
      return redirectWithInfo("/admin", t("edit.student.deleted"));
    }

    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const spaceNumberStr = formData.get("spaceNumber") as string;
    const homeRoom = formData.get("homeRoom") as string;

    if (!firstName?.trim() || !lastName?.trim()) {
      throw new Error(t("edit.student.errors.namesRequired"));
    }

    const spaceNumber = spaceNumberStr ? parseInt(spaceNumberStr) : null;

    if (spaceNumber) {
      const existingSpace = await prisma.space.findFirst({ where: { spaceNumber } });
      if (!existingSpace) {
        await prisma.space.create({ data: { spaceNumber } });
      }
    }

    const trimmedHomeRoom = homeRoom?.trim();
    if (trimmedHomeRoom) {
      const existingHomeroom = await prisma.teacher.findFirst({
        where: { homeRoom: trimmedHomeRoom }
      });
      if (!existingHomeroom) {
        throw new Error(t("edit.student.errors.homeroomMustExist"));
      }
    }

    await prisma.student.update({
      where: { id: parseInt(id) },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        spaceNumber,
        homeRoom: trimmedHomeRoom || null
      }
    });

    return redirectWithSuccess("/admin", { message: t("edit.student.updated") });
  } catch (error) {
    console.error("Error updating student:", error);
    return { error: error instanceof Error ? error.message : t("edit.student.errors.updateFailed") };
  }
}

export default function EditStudent({ loaderData }: Route.ComponentProps) {
  const { student, homerooms } = loaderData;
  const fetcher = useFetcher();
  const { t } = useTranslation("admin");

  const [firstName, setFirstName] = useState(student?.firstName ?? "");
  const [lastName, setLastName] = useState(student?.lastName ?? "");
  const [spaceNumber, setSpaceNumber] = useState(student?.spaceNumber?.toString() ?? "");
  const [homeRoom, setHomeRoom] = useState(student?.homeRoom ?? "");

  const isSubmitting = fetcher.state === "submitting";
  const isDeleting = fetcher.formData?.get("action") === "delete";

  return (
    <Page user={false}>
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t("edit.student.heading")}</h1>
        </div>

        <fetcher.Form method="post" className="space-y-6">
          <input type="hidden" name="id" value={student?.id?.toString() ?? ""} />

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("edit.student.basicInfo")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">{t("edit.student.firstName")}</label>
                <Input name="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">{t("edit.student.lastName")}</label>
                <Input name="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required disabled={isSubmitting} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("edit.student.assignments")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">{t("edit.student.spaceLabel")}</label>
                <Input type="number" name="spaceNumber" value={spaceNumber} onChange={(e) => setSpaceNumber(e.target.value)} disabled={isSubmitting} />
                <p className="text-xs text-gray-400">{t("edit.student.leaveEmpty")}</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">{t("edit.student.homeroomLabel")}</label>
                <input
                  name="homeRoom"
                  list="homeroom-options"
                  value={homeRoom}
                  onChange={(e) => setHomeRoom(e.target.value)}
                  disabled={isSubmitting}
                  placeholder={t("edit.student.homeroomPlaceholder")}
                  className="rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 focus:border-primary focus:outline-none disabled:opacity-60"
                />
                <datalist id="homeroom-options">
                  {homerooms.map((teacher) => (
                    <option key={teacher.homeRoom} value={teacher.homeRoom} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-400">{t("edit.student.leaveEmpty")}</p>
              </div>
            </div>
          </div>

          {fetcher.data?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm">{fetcher.data.error}</p>
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t">
            <Button type="submit" variant="primary" isPending={isSubmitting && !isDeleting} isDisabled={isSubmitting}>
              {!isSubmitting && <SaveIcon size={16} />}{" "}
              {isSubmitting && !isDeleting ? t("edit.student.submitting") : t("edit.student.submit")}
            </Button>
            <Button type="submit" variant="danger" name="action" value="delete" isPending={isSubmitting && isDeleting} isDisabled={isSubmitting}>
              {!isSubmitting && <Trash2Icon size={16} />}{" "}
              {isSubmitting && isDeleting ? t("edit.student.deleting") : t("edit.student.delete")}
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
