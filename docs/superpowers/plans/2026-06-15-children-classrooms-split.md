# Plan — Split Children / Classrooms + fix count-vs-roster

Date: 2026-06-15

## Step 1 — Extract + test the room-index helper (TDD)

- New `app/domain/children/classroom-roster.ts` with pure `buildRoomIndex<T>`.
- New `app/domain/children/classroom-roster.test.ts` (in the `npm test` glob).
  Tests written first:
  - groups by `homeRoom`, skips null `homeRoom`;
  - regression guard: for every room,
    `countByRoom.get(room) === studentsByRoom.get(room).length`.

## Step 2 — Classrooms page

- `git mv app/routes/admin/children.tsx app/routes/admin/classrooms.tsx`.
- Use `buildRoomIndex(allStudents)` for unfiltered roster + count.
- Search filters the **classroom list** by `q` against
  `homeRoom`/`teacherName` before grouping by grade.
- Keep grade pills, expand, `setClassroomGrade`, `#homeroom-` anchor.
- Update meta/header copy to "Classrooms".

## Step 3 — New Children page

- New `app/routes/admin/children.tsx`: lighter student card grid mirroring
  households.tsx styling (EntityAvatar, StatusPill, EntityLink, SectionHeader,
  StatCard). No pagination, no filter pills. Search on name + homeRoom.
- Loader: students with classroom (teacher relation: homeRoom, gradeLevel, id)
  and household (name, spaceNumber). `getTenantPrisma`,
  `protectToAdminAndGetPermissions`.

## Step 4 — Routing

- `app/routes.ts`: register `children` then `classrooms` before
  `students/:studentId`.

## Step 5 — Navigation

- `AdminSidebar.tsx`: two entries — Classrooms (GraduationCap) + Children (Users).

## Step 6 — Inbound links

- `students.$studentId.tsx` lines 323/330/398 → `/admin/classrooms`.
- Leave breadcrumb (315), post-delete redirect (228), roster-import (249),
  dashboard (728) on `/admin/children`.

## Step 7 — i18n

- Add `sidebar.classrooms` (en "Classrooms" / es "Aulas") to both locale files.
- Add a minimal `childrenList.*` block to both locale files.

## Verification

- `npm test` green (new classroom-roster suite included).
- `npx prisma generate` then `npm run typecheck` clean.
- No Playwright / dev server.
