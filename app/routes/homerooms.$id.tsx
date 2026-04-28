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
    select: { firstName: true, lastName: true, spaceNumber: true }
  });

  type StudentRow = { firstName: string; lastName: string; spaceNumber: number | null };
  type SpaceRow = { spaceNumber: number; status: Status };

  // Match the old per-student lookup contract: null spaceNumber falls
  // back to space 0, so a row with spaceNumber=0 (if any) is consulted
  // for unassigned students just like before.
  const spaceNumbers = Array.from(
    new Set((students as StudentRow[]).map((s) => s.spaceNumber ?? 0)),
  );
  const spaces = spaceNumbers.length
    ? await prisma.space.findMany({
        where: { spaceNumber: { in: spaceNumbers } },
        select: { spaceNumber: true, status: true },
      })
    : [];
  const statusBySpaceNumber = new Map<number, Status>(
    (spaces as SpaceRow[]).map((s) => [s.spaceNumber, s.status]),
  );

  return (students as StudentRow[]).map((student) => ({
    firstName: student.firstName,
    lastName: student.lastName,
    spaceNumber: student.spaceNumber,
    status: statusBySpaceNumber.get(student.spaceNumber ?? 0) ?? Status.EMPTY,
  }));
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
