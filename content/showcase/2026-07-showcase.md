---
title: "What's new — July 2026"
date: 2026-07-02
slug: whats-new-july-2026
category: "showcase"
---

June was a big month for the unglamorous-but-essential parts of running a school on PickupRoster: getting your roster in, getting your teachers in, and trusting the board during pickup. Here's what shipped.

## Roster import, rebuilt

The roster importer is now a proper guided flow. Upload an Excel file (.xlsx) or CSV, and an interactive column-mapping step lets you tell PickupRoster which of your columns is the student name, homeroom, pickup space, and so on — no more reshaping your SIS export to match our template. Invalid rows can be skipped instead of failing the whole file, siblings who share a pickup spot are automatically folded into one household (with a merge screen for anything ambiguous), and the "new families" count now counts households rather than students, so the summary matches reality. Imports are also considerably faster on large files. Find it at **Admin → Roster Import**.

## Teachers are now real accounts

Classrooms grew up in June. Every classroom has its own detail page, and teachers can now have actual TEACHER user accounts in your org — not just a name on a homeroom. You can import your whole teaching staff from a spreadsheet and send email invites in one pass, and any existing org user can be assigned as a classroom's teacher. This is the groundwork for teachers seeing their own homeroom's pickup status directly. Find it at **Admin → Classrooms**, with staff import under **Admin → Teachers → Import**.

## Duplicate students: detect and merge

Re-importing a roster mid-year used to be a good way to end up with two copies of the same kid. There's now a dedicated duplicates page that flags likely matches and walks you through merging them, keeping pickup history intact. Students also gained an optional name suffix field (Jr., III), which helps both matching and getting names right at the car line. Find it at **Admin → Students → Duplicates**.

## Drills: instant takeover and a smarter editor

When a drill goes live, every open PickupRoster screen in your school now switches to the live drill view immediately — front-gate tablets, office laptops, all of them, with no one needing to refresh. The drill template editor also autosaves as you type, and templates support a new selection column that auto-fills a classroom's teacher when you pick the room. Drill runs are recorded in a browsable history. Find it at **Admin → Drills**.

## A pickup board you don't have to babysit

A cluster of fixes made the live board more trustworthy during the pickup rush: tiles now age from a device-local clock (so a tablet with skewed time can't show wrong colors), stale yellow tiles heal back to green on their own without a manual refresh, the flicker on controller taps is gone, and the homeroom filter is back on the home screen. Nothing to configure — it's just the board, behaving.

## Guardrails on the dangerous stuff

Deleting a student from the Danger Zone now requires an explicit confirmation flow and notifies your org admins when it happens, so nothing disappears silently. Admin history also survives the daily board reset, so yesterday's pickup activity is still there in the morning. Both live under **Admin → Dashboard** and **Admin → History**.

---

If you're already on PickupRoster, log in and take the new roster importer for a spin — it's the best time of year to get next fall's roster loaded. If you're not yet, you can start a free trial at [pickuproster.com/pricing](https://pickuproster.com/pricing).
