import { Button, Input } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { ArrowLeftIcon, UserPlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/create.student";
import {
  getOrgFromContext,
  getTenantPrisma,
} from "~/domain/utils/global-context.server";
import {
  assertUsageAllowsIncrement,
  countOrgUsage,
  familiesDeltaForNewStudent,
  PlanLimitError,
  syncUsageGracePeriod,
} from "~/domain/billing/plan-usage.server";
import { Page } from "~/components/Page";
import { redirectWithSuccess } from "remix-toast";
import { getFixedT } from "~/lib/t.server";
import { detectLocale } from "~/i18n.server";

export const handle = { i18n: ["admin", "common"] };

export const meta: Route.MetaFunction = ({ data }) => {
  return [{ title: data?.metaTitle ?? "Create Student" }];
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  const homerooms = await prisma.teacher.findMany({
    select: { homeRoom: true },
    orderBy: { homeRoom: "asc" }
  });
  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");
  return {
    success: true,
    homerooms: homerooms.map((teacher) => teacher.homeRoom),
    metaTitle: t("create.student.metaTitle"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);
  const org = getOrgFromContext(context);
  const formData = await request.formData();

  const locale = await detectLocale(request, context);
  const t = await getFixedT(locale, "admin");

  const homeRoom = formData.get("homeRoom") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;

  try {
    if (!firstName?.trim() || !lastName?.trim()) {
      return { error: t("create.student.errors.namesRequired") };
    }

    const trimmedHomeRoom = homeRoom?.trim();
    if (trimmedHomeRoom) {
      const existingHomeroom = await prisma.teacher.findFirst({
        where: { homeRoom: trimmedHomeRoom }
      });
      if (!existingHomeroom) {
        return { error: t("create.student.errors.homeroomMustExist") };
      }
    }

    const householdId = null;
    const counts = await countOrgUsage(prisma, org.id);
    const famDelta = await familiesDeltaForNewStudent(prisma, org.id, householdId);
    assertUsageAllowsIncrement(org, counts, {
      students: 1,
      families: famDelta,
      classrooms: 0,
    });

    const student = await prisma.student.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        homeRoom: trimmedHomeRoom || null,
        householdId,
      }
    });

    const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
    if (freshOrg) {
      const nextCounts = await countOrgUsage(prisma, org.id);
      await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
    }

    return redirectWithSuccess("/admin", {
      message: t("create.student.created", {
        name: `${student.firstName} ${student.lastName}`,
      }),
    });
  } catch (error) {
    console.error("Error creating student:", error);
    if (error instanceof PlanLimitError) {
      return { error: error.message };
    }
    return {
      error: error instanceof Error ? error.message : t("create.student.errors.createFailed")
    };
  }
}

export default function CreateStudent({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const { homerooms } = loaderData;
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation("common");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [homeRoom, setHomeRoom] = useState("");

  const isSubmitting = fetcher.state === "submitting";

  return (
    <Page user={false}>
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <UserPlusIcon size={24} className="text-primary" />
            <h1 className="text-2xl font-bold">{t("create.student.heading")}</h1>
          </div>
        </div>

        <fetcher.Form method="post" className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("create.student.basicInfo")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="firstName" className="text-sm text-gray-400">{t("create.student.firstName")}</label>
                <Input id="firstName" name="firstName" placeholder={t("create.student.firstNamePlaceholder")} value={firstName} onChange={(e) => setFirstName(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="lastName" className="text-sm text-gray-400">{t("create.student.lastName")}</label>
                <Input id="lastName" name="lastName" placeholder={t("create.student.lastNamePlaceholder")} value={lastName} onChange={(e) => setLastName(e.target.value)} required disabled={isSubmitting} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("create.student.assignmentsOptional")}</h2>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="homeRoom" className="text-sm text-gray-400">{t("create.student.homeroomLabel")}</label>
                <input
                  id="homeRoom"
                  name="homeRoom"
                  list="homeroom-options"
                  placeholder={t("create.student.homeroomPlaceholder")}
                  value={homeRoom}
                  onChange={(e) => setHomeRoom(e.target.value)}
                  disabled={isSubmitting}
                  className="app-field disabled:opacity-60"
                />
                <datalist id="homeroom-options">
                  {homerooms.map((room) => (
                    <option key={room} value={room} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-400">{t("create.student.leaveEmpty")}</p>
                <p className="text-xs text-gray-400">{t("create.student.spaceHint")}</p>
              </div>
            </div>
          </div>

          {fetcher.data?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700 text-sm">{fetcher.data.error}</p>
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t">
            <Button variant="ghost" onPress={() => { setFirstName(""); setLastName(""); setHomeRoom(""); }} isDisabled={isSubmitting}>
              <ArrowLeftIcon size={16} /> {tCommon("buttons.back")}
            </Button>
            <div className="flex gap-3">
              <a href="/admin"><Button variant="ghost" isDisabled={isSubmitting}>{tCommon("buttons.cancel")}</Button></a>
              <Button type="submit" variant="primary" isPending={isSubmitting} isDisabled={!firstName.trim() || !lastName.trim()}>
                {!isSubmitting && <UserPlusIcon size={16} />}{" "}
                {isSubmitting ? t("create.student.submitting") : t("create.student.submit")}
              </Button>
            </div>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
