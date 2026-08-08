---
title: "Creating Recurring Dismissal Schedules"
date: 2026-07-07
slug: creating-recurring-dismissal-schedules
category: "setup"
estimated_time: "10 minutes"
difficulty: beginner
---

Every student in PickupRoster has a **default dismissal plan** — Car line, Walker, Bus, After-school program, Office pickup, or Other. When a family's routine differs on certain days ("every Wednesday grandma picks up both siblings"), don't edit the default. Create a **recurring dismissal exception** instead. Exceptions override the default plan only on the days they apply, and household-level exceptions keep sibling groups aligned automatically.

## Before you start

- You need admin access to your school's PickupRoster **Admin Panel**.
- The affected students must already be imported and grouped into a household. If siblings aren't linked yet, fix that first — see *Importing Student Rosters from Your SIS*.
- Confirm each student's default plan is correct. On the student page, open the **Dismissal** tab and tap a tile (Car line, Walker, Bus, After-school, Office, Other) to set the default route. Exceptions layer on top of this.
- Know the recurring pattern: which weekday, which pickup contact, and whether it's temporary (e.g., only during soccer season) or open-ended.

## 1. Open the Households page

1. Log in and open the **Admin Panel**.
2. In the sidebar under **Students & Households**, click **Households**.

The page header reads **Households, exceptions, and pickup ROI**. The **Active exceptions today** stat at the top counts households with at least one exception active right now.

![Households page](/images/guides/creating-recurring-dismissal-schedules/step-1.png)

## 2. Add a recurring exception

1. Scroll to the **Add a recurring dismissal exception** panel.
2. **Household** — choose the family from the dropdown. The exception applies to every student in the household, which is exactly what you want for siblings who leave together.
3. **Dismissal plan** — pick the plan that applies on the exception days (e.g., **Office pickup**).
4. **Schedule** — choose **Repeats weekly**. (Pick **One-time exception** only for a single date; that flow needs a **Specific date** instead.)
5. **Weekly day** — select the weekday, e.g., **Wednesday**.

![New exception form](/images/guides/creating-recurring-dismissal-schedules/step-2.png)

## 3. Bound temporary routines with dates

If the routine is temporary — a six-week PT schedule, a season of practice — set the optional date window:

1. **Starts on** — first date the weekly exception applies.
2. **Ends on** — last date it applies. After this date the exception stops firing on its own; you don't need to remember to remove it.

Leave both blank for an open-ended weekly exception.

## 4. Add contact and notes

1. **Pickup contact** — optional override contact for exception days (e.g., the grandparent's name and phone). Staff at the lane see this instead of the household's usual contacts.
2. **Notes** — write what staff need at a glance. Follow the placeholder's example: "every Wednesday grandma picks up both siblings from the side door."
3. Click **Save exception**. You'll see the confirmation **"Recurring dismissal exception saved."**

## 5. Verify it's working

1. On the Households page, the family's row now shows an active-exception count (e.g., **· 1 active exception**), and the **Active recurring exceptions** section lists the entry with its weekday and any date bounds.
2. Open the household's detail page — the exception appears under **Upcoming dismissal exceptions** with a **WK** tile marking it as weekly. The right rail's **Default dismissal plan** panel reminds staff the default is *used when no exception is active*.
3. On the matching weekday, check the **Dashboard**: the **Exceptions today** stat ("Different dismissal plan today") includes the household, and the student's page shows a **Today: Office pickup** pill.
4. To filter, use the **Has exception today** filter on the Households list.

## 6. End or change a schedule

Exceptions aren't edited in place — archive and re-create:

1. Find the entry under **Active recurring exceptions**.
2. Click **Archive**. You'll see **"Recurring exception archived."** and it stops applying immediately.
3. If the routine changed rather than ended, add a new exception with the updated day, plan, or dates.

Every create and archive is written to the audit log ("Created a dismissal exception" / "Archived a dismissal exception"), so you can always reconstruct who changed what.

## Troubleshooting

**The exception isn't showing on the student today.** Check the weekday matches, and that today falls inside the **Starts on** / **Ends on** window. A weekly exception with an **Ends on** in the past is expired — add a new one.

**Only one sibling is affected.** The exception was probably created for the wrong household, or the siblings live in separate household records. Merge duplicates first (Households → duplicates review); pickup history and dismissal exceptions move to the surviving record automatically.

**I picked "One-time exception" by mistake.** One-time entries need a **Specific date** and fire once. Archive it and re-create with **Repeats weekly**.

**The default plan changed instead of the exception.** Someone tapped a dismissal tile on the student page. Tiles set the *default* route; exceptions (today / weekly) override it only on the day they apply. Reset the tile, then add a proper exception.

**Can't find the Archive button.** You're on the household detail view — archiving lives in the **Active recurring exceptions** section of the main Households page.
