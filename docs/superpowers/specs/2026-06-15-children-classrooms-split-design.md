# Design — Split Children / Classrooms admin pages + fix count-vs-roster bug

Date: 2026-06-15
Status: accepted

## Problem

`app/routes/admin/children.tsx` combines two concerns: a grade-grouped,
expandable **classroom** view and an implicit **student** search. This causes a
real bug:

- The per-classroom student COUNT (`enrolmentByRoom`) is built from **all**
  students.
- The expandable ROSTER list (`studentsByRoom`) is built from the
  **search-filtered** students.

So whenever a `?q=` search is active in the URL (including a stale one), a
classroom card shows "N students" but expands to "no kids" — the count and the
roster disagree. This is the user's complaint.

## Decision

Split into two pages with distinct responsibilities, and remove the source of
divergence.

### 1. Classrooms page → `/admin/classrooms`

Keeps the current look/behavior of `children.tsx`: grade-grouped expandable
classroom cards, stats row, grade-pill filter, the `setClassroomGrade` action,
and the `#homeroom-<id>` anchor auto-expand.

**The fix:** the search box now filters **classrooms** (matching `homeRoom` and
`teacherName`), not students. The roster + count for every room are built from
the **same unfiltered** student set via a new pure helper `buildRoomIndex`, so
`countByRoom.get(room) === studentsByRoom.get(room).length` is an invariant they
can never violate. The grade-pill filter stays.

### 2. Children page → `/admin/children` (rewritten)

A lighter, searchable student list styled like the Households page. A searchable
card grid — **no pagination, no filter pills**. Search matches student
first/last name and `homeRoom`. Each student card shows: full name, classroom
(link to `/admin/classrooms?grade=<grade>#homeroom-<classroomId>`), household
(link to `/admin/households/<householdId>` if assigned), and pickup space number.
The card name links to `/admin/students/<id>`.

## Consistency invariant (regression guard)

`buildRoomIndex(students)` returns `{ studentsByRoom, countByRoom }` derived from
one pass over one input array. Unit test asserts, for every room,
`countByRoom.get(room) === studentsByRoom.get(room).length`.

## Navigation / links

- Sidebar gains a `Classrooms` entry (GraduationCap) and keeps `Children`
  (Users).
- Student-detail classroom-context links (grade + `#homeroom-` anchor) point at
  `/admin/classrooms`. The "← Children" breadcrumb, post-delete redirect, and
  post-import redirect stay at `/admin/children`.

## i18n

- Add `sidebar.classrooms` to en/es. Keep `sidebar.children`.
- Classrooms page reuses the existing `children.*` keys (minimal churn; just the
  page title/copy is "Classrooms").
- New Children list page uses a small `childrenList.*` block in en/es.
