---
title: "Configuring pickup zones and lane assignments"
date: 2026-05-12
slug: configuring-pickup-zones-and-lane-assignments
category: setup
estimated_time: 10 minutes
difficulty: intermediate
---

Pickup zones are the physical loading areas at your school — typically labeled by grade band, exit, or family last name. Lane assignments tell the carline display which cars to call to which zone. Get this right once and the daily dismissal runs itself.

## Before you start

- You must be signed in as an **Owner** or **Admin**. Dispatcher accounts can call cars to a zone but cannot create or rename zones.
- Walk your campus first. Know how many physical lanes you have, where each lane begins, and which zone each lane feeds. A quick phone photo from the curb helps.
- Decide your zone scheme **before** importing rosters. If you change zones after assigning families, you will need to bulk-reassign — see Troubleshooting.
- On the District tier, zones are per school. Use the tenant switcher at the top-left to confirm you are editing the correct campus.

## 1. Open the zones editor

1. Sign in at `https://app.pickuproster.com`.
2. In the left sidebar, click **Settings**.
3. Click **Pickup Zones** in the submenu. You should land on a page titled **Pickup Zones & Lanes**.

![Pickup Zones settings screen](/images/guides/configuring-pickup-zones-and-lane-assignments/step-1.png)

## 2. Create your zones

1. Click **New zone** at the top right.
2. Enter a **Zone name** parents will recognize — for example, `K-2 South`, `3-5 North`, or `Sibling Lane`. Keep it under 18 characters so it fits on the carline display.
3. Pick a **Zone color**. This color shows on the parent app map, the carline display call queue, and the daily pickup report. Use colors that are visually distinct — avoid two shades of the same hue.
4. Optionally set a **Zone capacity** — the number of cars that can be loading at once. The dispatcher view warns when a zone exceeds this count.
5. Click **Save zone**.
6. Repeat for every zone. Most elementary schools end up with three to five zones. Middle and high schools often use one or two.

![New zone dialog](/images/guides/configuring-pickup-zones-and-lane-assignments/step-2.png)

## 3. Assign lanes to each zone

A lane is a physical position a car pulls into. Most schools have two to four lanes per zone.

1. From the **Pickup Zones & Lanes** page, click the zone name you just created.
2. Under **Lanes**, click **Add lane**.
3. Enter a short **Lane label** that matches your painted curb markings — for example, `A1`, `A2`, `B1`. These appear on the dispatcher tablet exactly as typed.
4. Click **Save lane** and repeat for each lane in the zone.
5. Drag lane rows to reorder them. The dispatcher view fills lanes top-to-bottom in this order during a pickup wave.

![Lane configuration for a zone](/images/guides/configuring-pickup-zones-and-lane-assignments/step-3.png)

## 4. Set default zone rules

Default rules auto-assign students to a zone based on grade or family. Setting these now saves hours during roster import.

1. From the **Pickup Zones & Lanes** page, click **Assignment rules** at the top right.
2. Click **New rule**.
3. Choose a **Rule type**:
   - **By grade** — pick one or more grades, then pick a target zone.
   - **By family** — students sharing a guardian are routed to the youngest sibling's zone. Toggle this on if you want siblings called together.
   - **Manual override** — leaves students unassigned for you to place individually.
4. Click **Save rule**.
5. Drag rules to reorder them. Higher rules win when a student matches multiple.

## 5. Test the routing

1. Click **Preview routing** at the top of the Pickup Zones page.
2. Type a student's name or ID into the search box.
3. Confirm the previewed zone matches your intent. If a sibling rule should override a grade rule, check the rule order in step 4.5.
4. Spot-check at least five students across different grades before publishing.

## 6. Publish and notify

1. Click **Publish zones** at the top right. You will see "Zones published. Parents will see updated maps within 10 minutes."
2. Open the **Parents** tab in the same settings area and click **Send zone update notice** to push an in-app banner. Parents on the District tier get a one-line email summary instead.
3. Walk outside with the carline display tablet and verify each lane label matches the painted curb. Fix any mismatches in step 3 before the next pickup.

## Troubleshooting

**"You cannot delete a zone with active students" error.** Reassign every student off the zone first. The fastest path is **Students → Filter by zone → Bulk reassign**.

**A lane disappears from the dispatcher view.** Lanes are hidden when their parent zone is set to **Inactive**. Open the zone, toggle **Active**, and republish.

**Sibling rule is not grouping siblings.** Siblings are detected by shared guardian email. If two parents are listed on the same kids with different emails, link them via **Students → Family → Merge guardians**. Then re-run the assignment rule.

**Zone color looks washed out on the carline display.** The carline display dims colors by roughly 15% to reduce glare. Pick a saturated hex (above 60% saturation) for any zone color you want to read at a glance.

**Capacity warnings are firing constantly.** Either raise the capacity in step 2.4, or stagger your dismissal bell by grade in **Settings → Schedules**. Capacity is a soft warning — it never blocks a car from being called.

**I renamed a zone and the daily report still shows the old name.** Reports are generated nightly and cache the prior day's zone names. Tomorrow's report will reflect the new name. To regenerate today's report, open **Reports → Today → Rebuild**.
