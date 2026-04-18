import { Button, Input } from "@heroui/react";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { SchoolIcon, UserIcon, XIcon } from "lucide-react";
import { protectToAdminAndGetPermissions } from "~/sessions.server";
import type { Route } from "./+types/create.homeroom";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { redirectWithSuccess } from "remix-toast";

export async function loader({ request, context }: Route.LoaderArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);

  const [unassignedStudents, existingHomerooms] = await Promise.all([
    prisma.student.findMany({
      where: { homeRoom: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
    }),
    prisma.teacher.findMany({ select: { homeRoom: true } })
  ]);

  return {
    students: unassignedStudents,
    existingHomerooms: existingHomerooms.map((t) => t.homeRoom)
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  await protectToAdminAndGetPermissions(context);
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();

  const homeRoom = formData.get("homeRoom") as string;
  const selectedStudentsJson = formData.get("selectedStudents") as string;

  try {
    if (!homeRoom?.trim()) {
      return { error: "Homeroom name/number is required" };
    }

    const existingTeacher = await prisma.teacher.findUnique({
      where: { homeRoom: homeRoom.trim() }
    });

    if (existingTeacher) {
      return { error: `Homeroom "${homeRoom}" already exists` };
    }

    const teacher = await prisma.teacher.create({
      data: { homeRoom: homeRoom.trim() }
    });

    let studentCount = 0;
    if (selectedStudentsJson) {
      const selectedStudents = JSON.parse(selectedStudentsJson);
      const studentUpdates = selectedStudents.map((studentId: number) =>
        prisma.student.update({
          where: { id: studentId },
          data: { homeRoom: teacher.homeRoom }
        })
      );
      if (studentUpdates.length > 0) {
        await Promise.all(studentUpdates);
        studentCount = studentUpdates.length;
      }
    }

    const message =
      studentCount > 0
        ? `Homeroom "${homeRoom}" created with ${studentCount} student${studentCount !== 1 ? "s" : ""}`
        : `Homeroom "${homeRoom}" created successfully`;

    return redirectWithSuccess("/admin", { message });
  } catch (error) {
    console.error("Error creating homeroom:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to create homeroom"
    };
  }
}

export default function CreateHomeroom() {
  const fetcher = useFetcher();
  const { students, existingHomerooms } = useLoaderData<typeof loader>();

  const [homeRoom, setHomeRoom] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<
    Array<{ id: number; firstName: string; lastName: string; spaceNumber?: number | null }>
  >([]);

  const isSubmitting = fetcher.state === "submitting";

  const handleStudentSelect = (studentId: string | number) => {
    const id = parseInt(studentId.toString());
    const student = students.find((s) => s.id === id);
    if (student && !selectedStudents.find((s) => s.id === id)) {
      setSelectedStudents((prev) => [
        ...prev,
        { id: student.id, firstName: student.firstName, lastName: student.lastName, spaceNumber: student.spaceNumber }
      ]);
    }
  };

  const removeSelectedStudent = (studentId: number) => {
    setSelectedStudents((prev) => prev.filter((s) => s.id !== studentId));
  };

  const availableStudents = students.filter(
    (student) => !selectedStudents.find((s) => s.id === student.id)
  );

  const isHomeroomDuplicate = !!(homeRoom.trim() && existingHomerooms.includes(homeRoom.trim()));

  return (
    <Page user={false}>
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <SchoolIcon size={24} className="text-primary" />
            <h1 className="text-2xl font-bold">Create New Homeroom</h1>
          </div>
        </div>

        <fetcher.Form method="post" className="space-y-6">
          <input
            type="hidden"
            name="selectedStudents"
            value={JSON.stringify(selectedStudents.map((s) => s.id))}
          />

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Homeroom Information</h2>
            <label className="text-sm text-gray-400">Homeroom Name/Number</label>
            <Input
              name="homeRoom"
              placeholder="e.g., 101, Ms. Smith"
              value={homeRoom}
              onChange={(e) => setHomeRoom(e.target.value)}
              required
              disabled={isSubmitting}
            />
            {isHomeroomDuplicate && <p className="text-red-400 text-sm">This homeroom already exists</p>}
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              Assign Students ({selectedStudents.length} selected)
            </h2>
            {availableStudents.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Add Student to Homeroom</label>
                <select
                  onChange={(e) => { if (e.target.value) { handleStudentSelect(e.target.value); e.target.value = ""; } }}
                  disabled={isSubmitting}
                  className="rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 focus:border-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="">Search and select a student</option>
                  {availableStudents.map((student) => (
                    <option key={student.id} value={student.id.toString()} className="bg-gray-900 text-gray-100">
                      {student.firstName} {student.lastName}{student.spaceNumber ? ` (Space: ${student.spaceNumber})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {selectedStudents.length > 0 && (
            <div className="space-y-2">
              {selectedStudents.map((student) => (
                <div key={student.id} className="flex items-center justify-between p-2 bg-white/10 rounded border border-white/20">
                  <span className="font-medium">
                    {student.firstName} {student.lastName}
                    {student.spaceNumber && <span className="text-sm text-gray-400 ml-2">(Space: {student.spaceNumber})</span>}
                  </span>
                  <Button size="sm" variant="ghost" isIconOnly onPress={() => removeSelectedStudent(student.id)} isDisabled={isSubmitting}>
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

          <div className="flex justify-between items-center pt-6 border-t">
            <a href="/admin"><Button variant="ghost" isDisabled={isSubmitting}>
              Cancel
            </Button></a>
            <Button type="submit" variant="primary" isPending={isSubmitting} isDisabled={!homeRoom.trim() || isHomeroomDuplicate}>
              {!isSubmitting && <SchoolIcon size={16} />} {isSubmitting ? "Creating..." : "Create Homeroom"}
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
