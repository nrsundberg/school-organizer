import { Button, Input } from "@heroui/react";
import { useFetcher } from "react-router";
import { useState } from "react";
import { ArrowLeftIcon, UserPlusIcon } from "lucide-react";
import type { Route } from "./+types/create.student";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { Page } from "~/components/Page";
import { redirectWithSuccess } from "remix-toast";

export const meta: Route.MetaFunction = () => {
  return [{ title: "Create Student" }];
};

export async function loader({ context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  const homerooms = await prisma.teacher.findMany({
    select: { homeRoom: true },
    orderBy: { homeRoom: "asc" }
  });
  return { success: true, homerooms: homerooms.map((teacher) => teacher.homeRoom) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);
  const formData = await request.formData();

  const spaceNum = formData.get("spaceNum") as string;
  const homeRoom = formData.get("homeRoom") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;

  try {
    if (!firstName?.trim() || !lastName?.trim()) {
      return { error: "First name and last name are required" };
    }

    const spaceNumber =
      spaceNum && !isNaN(parseInt(spaceNum)) ? parseInt(spaceNum) : null;

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
        return { error: "Please choose an existing homeroom from suggestions" };
      }
    }

    const student = await prisma.student.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        spaceNumber,
        homeRoom: trimmedHomeRoom || null
      }
    });

    return redirectWithSuccess("/admin", {
      message: `Student ${student.firstName} ${student.lastName} created successfully`
    });
  } catch (error) {
    console.error("Error creating student:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to create student"
    };
  }
}

export default function CreateStudent({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const { homerooms } = loaderData;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [spaceNumber, setSpaceNumber] = useState("");
  const [homeRoom, setHomeRoom] = useState("");

  const isSubmitting = fetcher.state === "submitting";

  return (
    <Page user={false}>
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <UserPlusIcon size={24} className="text-primary" />
            <h1 className="text-2xl font-bold">Create New Student</h1>
          </div>
        </div>

        <fetcher.Form method="post" className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">First Name</label>
                <Input name="firstName" placeholder="Enter first name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required disabled={isSubmitting} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Last Name</label>
                <Input name="lastName" placeholder="Enter last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required disabled={isSubmitting} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Assignments (Optional)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Parking Space Number</label>
                <Input type="number" name="spaceNum" placeholder="Enter space number" value={spaceNumber} onChange={(e) => setSpaceNumber(e.target.value)} disabled={isSubmitting} />
                <p className="text-xs text-gray-400">Leave empty if not assigned</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-400">Homeroom</label>
                <input
                  name="homeRoom"
                  list="homeroom-options"
                  placeholder="Select existing homeroom"
                  value={homeRoom}
                  onChange={(e) => setHomeRoom(e.target.value)}
                  disabled={isSubmitting}
                  className="rounded-lg border border-gray-500 bg-gray-900 px-3 py-2 text-gray-100 focus:border-primary focus:outline-none disabled:opacity-60"
                />
                <datalist id="homeroom-options">
                  {homerooms.map((room) => (
                    <option key={room} value={room} />
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
            <Button variant="ghost" onPress={() => { setFirstName(""); setLastName(""); setSpaceNumber(""); setHomeRoom(""); }} isDisabled={isSubmitting}>
              <ArrowLeftIcon size={16} /> Reset Form
            </Button>
            <div className="flex gap-3">
              <a href="/admin"><Button variant="ghost" isDisabled={isSubmitting}>Cancel</Button></a>
              <Button type="submit" variant="primary" isPending={isSubmitting} isDisabled={!firstName.trim() || !lastName.trim()}>
                {!isSubmitting && <UserPlusIcon size={16} />} {isSubmitting ? "Creating..." : "Create Student"}
              </Button>
            </div>
          </div>
        </fetcher.Form>
      </div>
    </Page>
  );
}
