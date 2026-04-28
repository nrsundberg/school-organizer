import { useTranslation } from "react-i18next";
import { Status } from "~/db/browser";
import type { Route } from "./+types/homerooms.$id";
import { getTenantPrisma } from "~/domain/utils/global-context.server";

export const handle = { i18n: ["roster"] };

export async function loader({ params, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  const teacher = await prisma.teacher.findUnique({
    where: { id: parseInt(params.id) }
  });

  const students = await prisma.student.findMany({
    where: { homeRoom: teacher?.homeRoom },
    select: {
      firstName: true,
      lastName: true,
      household: { select: { spaceNumber: true } },
    },
  });

  interface Student {
    firstName: string;
    lastName: string;
    spaceNumber: number | null;
    status: Status;
  }

  const studentReturn: Student[] = [];

  for (let student of students) {
    const spaceNumber = student.household?.spaceNumber ?? null;
    let spaceStatus = await prisma.space.findFirst({
      where: { spaceNumber: spaceNumber ?? 0 },
      select: { status: true }
    });
    studentReturn.push({
      firstName: student.firstName,
      lastName: student.lastName,
      spaceNumber,
      status: spaceStatus ? spaceStatus.status : Status.EMPTY
    });
  }

  return studentReturn;
}

export default function StudentList({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("roster");
  return (
    <div>
      <div className="grid grid-cols-5 lg:grid-cols-10 auto-rows-fr h-fit">
        {loaderData.map((student, i) => (
          <div
            key={i}
            className={
              "h-28 p-2 border border-white text-center " +
              (student.status === Status.ACTIVE ? "bg-green-700" : "bg-gray-700")
            }
          >
            <div className="text-lg">
              {student.firstName + " " + student.lastName}
            </div>
            <div>{t("homerooms.spaceLabel", { number: student.spaceNumber ?? "" })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
