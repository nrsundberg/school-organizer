---
title: "Setting up your first drill template"
date: 2026-04-24
slug: setting-up-your-first-drill-template
category: setup
estimated_time: 12 minutes
difficulty: beginner
---

Drill templates are how PickupRoster turns "we have to run a drill next Tuesday" into a calm, repeatable thing. You build the template once — fire, lockdown, severe weather, or anything else your district requires — and every future run of that drill loads the same checklist, the same student roster, and the same after-action report. This guide walks through cloning a starter template from our library, adapting it to your campus, running it live, and printing the after-action sheet for your binder.

## Before you start

- You must be signed in as an **Owner** or **Admin**. Teachers and Dispatchers can participate in a live drill but can't author or edit templates.
- Your roster should be imported first. If the student list is empty, the drill checklist will run, but the per-class roll won't have anyone to mark off. See [Importing student rosters from your SIS](/guides/importing-student-rosters-from-sis) if you haven't done that yet.
- On the District tier, drill templates live inside a single school. Use the tenant switcher at the top-left to confirm you're working in the right building before you start.
- Have your school's emergency operations plan or state drill requirements handy. The starter library is grounded in **SRP v4.2** (Standard Response Protocol), **NFPA 101**, **FEMA REMS**, and **NWS** guidance, but the names of doors, assembly points, and shelter zones on your campus are yours to fill in.

## 1. Open the drill template library

1. Sign in at `https://app.pickuproster.com`.
2. In the left sidebar, click **Drills**. You'll land on the **Drill checklists** page, which shows every template your school has cloned plus options to create a new one.
3. In the top-right, click **Library**. This opens the drill template library at **Admin → Drills → Library**.

The library lists twelve starter templates. The first time you visit, none of them are cloned, and every card shows a **Clone to my templates** button.

## 2. Pick a starter template

The twelve starters cover the most common K–12 drills:

- **Fire Evacuation** — full evacuation via primary egress to assembly point, NFPA 101.
- **Lockdown (SRP)** — "Locks, Lights, Out of Sight" for an internal threat.
- **Secure (SRP)** — "Get Inside. Lock Outside Doors." when the threat is outside.
- **Hold (SRP)** — "In Your Room. Clear the Halls." for a contained internal issue.
- **Evacuate — Off-Site** — relocate to a secondary site (gas leak, bomb threat).
- **Shelter-in-Place (Hazmat)** — seal-the-room for chemical or air-quality events.
- **Severe Weather / Tornado** — interior low-level shelter, drop and cover.
- **Earthquake — Drop, Cover, Hold On** — two-phase, during plus post-quake evacuation.
- **Reunification (SRM)** — Standard Reunification Method after an evacuation.
- **Bus Evacuation** — front/rear/split bus evac roll.
- **Bomb Threat / Suspicious Package** — DHS/CISA caller-info checklist plus evac decision.
- **Medical Emergency / AED** — scene-safety, 911, AED, CPR roles.

Click **Clone to my templates** on the one you'll run first. We'd start with **Fire Evacuation** — every state mandates it, and it's the simplest layout, so you'll learn the editor before you tackle a lockdown.

You'll be redirected to the editor at **Admin → Drills → (template)**. The new template now also appears in your **Your templates** list back on the main Drills page.

## 3. Adapt the template to your campus

The editor opens with the cloned checklist already populated. Two things to do here:

1. **Rename the template** if you want something more specific. The default keeps the source name (e.g. "Fire Evacuation"). Change it to "Main Building Fire Evacuation" or "Annex Lockdown" if you'll have more than one variant per drill type. Click **Save layout** when you've renamed.
2. **Edit the rows and columns** to match your campus. The Fire Evacuation starter, for example, has a row per class plus columns for Teacher, Assembly Point, Headcount, and Missing Students. Your assembly points, door numbers, and reunification site names go here.

Use **+ Add row** to add a new class or staff group, **+ Add column** for any extra field your drill protocol requires, and the trash icons to remove anything that doesn't apply. Click **Save layout** any time you make a structural change — the template updates immediately.

A common first edit: drop the columns you don't use, then add a column for "Wheelchair / mobility-impaired plan" so it shows up on every print-out. Schools that document this in the template never forget it during a real evacuation.

## 4. Run a drill (practice mode)

Before your first real drill, do a dry run with no students in the building. This catches layout problems while the stakes are zero.

1. From the template editor, click **Run drill** in the bottom action bar.
2. PickupRoster starts a live drill run and immediately drops every signed-in staff member into a shared takeover view at `/drills/live`. The dashboard, schedules, and other admin pages are inaccessible until the drill is closed — this is intentional, so nobody is staring at the wrong screen when the thing that matters is happening here.
3. Mark each row off as classes report in. Anyone signed in to the school can see and edit the same checklist; updates appear live for everyone.
4. Use the **Notes** field to log what happened (false start at door 4, staircase B took 90 seconds, etc.) and the **Follow-up items** list for anything that needs to change before the next run.
5. When the drill is finished, click **End drill** at the bottom. PickupRoster ends the takeover and saves the run to your history.

During a real drill, the takeover behaviour is the most important feature here: it stops staff from accidentally interacting with parent-facing screens or the carline display while a fire alarm is sounding.

## 5. Print the after-action sheet

State drill logs and your school's binder usually want a paper record. Two ways to get one:

- **From the template editor**, click **Print preview** in the action bar. This goes to **Admin → Print → Drills → (template)** and opens a clean, no-chrome layout suitable for `Cmd/Ctrl + P`.
- **From history**, go to **Admin → History**, find the drill run, and use the print link there to print the completed checklist with marks, notes, and follow-ups.

Schools running monthly fire drills typically save the print preview as a PDF and drop it into a shared safety folder right after the drill ends. That way the date, marks, and notes are in one place when the fire marshal asks for them six months later.

## Troubleshooting

**"Another drill is already running."** Only one drill run can be active per school at a time, by design. If you see this when starting a drill, somebody else already started one — go to `/drills/live` to find it, and either join that run or end it first.

**Old `/admin/fire-drill/...` bookmark stops working.** The feature was renamed from "Fire Drill" to "Drills" when we shipped the template library. Old URLs redirect, but you should re-bookmark from the new path: `/admin/drills/(template-id)`.

**Cloned the wrong template.** Open the template from your Drills list and click **Delete this template**. Cloned templates are independent copies — deleting yours doesn't affect the library or anyone else.

**Edits aren't sticking.** The editor saves on **Save layout**, not automatically. If you navigate away without saving, your row and column changes are lost (renames save separately). Save before leaving.

**Want to share a template across schools.** District-tier customers: clone the template in each school for now. A district-level "shared library" is on the roadmap; in the meantime, the safest pattern is to set up the master in one school, then re-clone from the global library and copy the changes across.

Once your first template is set up and you've run a dry drill, schedule the real one. The next run will reuse the same checklist — no rebuild, no re-typing — and your after-action history will start to grow into the audit trail your state drill log expects.
