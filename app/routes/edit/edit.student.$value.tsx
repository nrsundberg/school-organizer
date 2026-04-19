import { Button, Input } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { SaveIcon, Trash2Icon } from "lucide-react";
import type { Route } from "./+types/edit.student.$value";
import { countOrgUsage, syncUsageGracePeriod } from "~/domain/billing/plan-usage.server";
import { getOrgFromContext, getTenantPrisma } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { redirectWithInfo, redirectWithSuccess } from "remix-toast";

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

  if (!id || isNaN(parseInt(id))) {
    throw new Error("Invalid student ID");
  }

  try {
    if (action === "delete") {
      await prisma.student.delete({ where: { id: parseInt(id) } });
      const freshOrg = await prisma.org.findUnique({ where: { id: org.id } });
      if (freshOrg) {
        const nextCounts = await countOrgUsage(prisma, org.id);
        await syncUsageGracePeriod(prisma, freshOrg, nextCounts);
      }
      return redirectWithInfo("/admin", "Student deleted successfully");
    }

    const firstName = formData.get("firstName") as string;
    const lastName = formData.get("lastName") as string;
    const spaceNumberStr = formData.get("spaceNumber") as string;
    const homeRoom = formData.get("homeRoom") as string;

    if (!firstName?.trim() || !lastName?.trim()) {
      throw new Error("First name and last name are required");
    }

    const spaceNumber = spaceNumberStr ? parseInt(spaceNumberStr) : null;

    if (spaceNumber) {
      await prisma.space.upsert({
        where: { spaceNumber },
        update: {},
        create: { spaceNumber }
      });
    }

    const trimmedHomeRoom = homeRoom?.trim();
    if (trimmedHomeRoom) {
      const existingHomeroom = await prisma.teacher.findUnique({
        where: { homeRoom: trimmedHomeRoom }
      });
      if (!existingHomeroom) {
        throw new Error("Please choose an existing homeroom from suggestions");
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

    return redirectWithSuccess("/admin", { message: "Student updated successfully" });
  } catch (error) {
    console.error("Error updating student:", error);
    return { error: error instanceof Error ? error.message : "Failed to update student" };
  }
}

export default function EditStudent({ loaderData }: Route.ComponentProps) {
  const { student, homerooms } = loaderData;
  const fetcher = useFetcher();

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
          <h1 className="text-2xl font-bold">Edit Student</h1>
        </div>

        <fetcher.Form method="post" className="space-y-6">
          <input type="hidden" name="id" value={student?.id?.toString() ?? ""} />

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">First Name</label>
                <Input name="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Last Name</label>
                <Input name="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required disabled={isSubmitting} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Assignments</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Parking Space Number</label>
                <Input type="number" name="spaceNumber" value={spaceNumber} onChange={(e) => setSpaceNumber(e.target.value)} disabled={isSubmitting} />
                <p className="text-xs text-gray-400">Leave empty if not assigned</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Homeroom</label>
                <input
                  name="homeRoom"
                  list="homeroom-options"
                  value={homeRoom}
                  onChange={(e) => setHomeRoom(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Select existing homeroom"
                  className="rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 focus:border-primary focus:outline-none disabled:opacity-60"
                />
                <datalist id="homeroom-options">
                  {homerooms.map((teacher) => (
                    <option key={teacher.homeRoom} value={teacher.homeRoom} />
                  ))}
                </datalist>
                <p className="text-xs text-gray-400">Leave empty if not assigned</p>
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
              {!isSubmitting && <SaveIcon size={16} />} {isSubmitting && !isDeleting ? "Updating..." : "Update Student"}
            </Button>
            <Button type="submit" variant="danger" name="action" value="delete" isPending={isSubmitting && isDeleting} isDisabled={isSubmitting}>
              {!isSubmitting && <Trash2Icon size={16} />} {isSubmitting && isDeleting ? "Deleting..." : "Delete Student"}
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
