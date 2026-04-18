import { NavLink, Outlet, useOutlet } from "react-router";
import { Page } from "~/components/Page";
import type { Route } from "./+types/homerooms";
import { getTenantPrisma } from "~/domain/utils/global-context.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const prisma = getTenantPrisma(context);
  return prisma.teacher.findMany();
}

export default function TeacherList({ loaderData }: Route.ComponentProps) {
  let teachers = loaderData;
  let outlet = useOutlet();

  return (
    <Page user={false}>
      <div className="flex pt-3 divide-x-2">
        <div className="pl-5 pr-10">
          <h1 className="text-xl font-bold">Homerooms</h1>
          {teachers.map((teacher) => (
            <div key={teacher.id}>
              <NavLink
                to={`./${teacher.id}`}
                className={({ isActive }) =>
                  "text-lg" + (isActive ? " text-primary-600 font-bold" : "")
                }
              >
                {teacher.homeRoom}
              </NavLink>
            </div>
          ))}
        </div>
        {!outlet && <div />}
        <Outlet />
      </div>
    </Page>
  );
}
