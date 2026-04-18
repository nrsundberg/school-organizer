import { z } from "zod";
import invariant from "tiny-invariant";
import { convertToDataType, headerBody } from "~/csvParser/utils";
import type { Route } from "./+types/data.students";
import { getTenantPrisma } from "~/domain/utils/global-context.server";
import { dataWithSuccess } from "remix-toast";

const schema = z.object({
  "Last Name": z.string().min(1),
  First: z.string().min(1),
  "Carline Number": z.number(),
  Homeroom: z.string().min(1)
});

export async function action({ request, context }: Route.ActionArgs) {
  const prisma = getTenantPrisma(context);

  // Use native Web API for multipart form data (works on Cloudflare Workers)
  const formData = await request.formData();
  const file = formData.get("file");
  invariant(file instanceof File, "Must include file");

  const h = headerBody(await file.text());
  const allCsvData = convertToDataType<typeof schema>(h.header, h.body);

  const homeRooms = new Set(h.body.map((it) => it[3]));
  for (const room of homeRooms) {
    const exists = await prisma.teacher.findFirst({
      where: { homeRoom: room }
    });
    if (!exists) {
      await prisma.teacher.create({ data: { homeRoom: room } });
    }
  }

  const rows = allCsvData.map((row) => ({
    firstName: row.First as string,
    lastName: row["Last Name"] as string,
    spaceNumber: row["Carline Number"] as number,
    homeRoom: row.Homeroom as string,
  }));

  const CHUNK_SIZE = 50;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await prisma.student.createMany({
      data: rows.slice(i, i + CHUNK_SIZE),
    });
  }

  return dataWithSuccess(
    { result: "Created student records from csv" },
    { message: "Created student records from csv" }
  );
}
