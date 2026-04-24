---
title: "Importing student rosters from your SIS"
date: 2026-04-24
slug: importing-student-rosters-from-sis
category: setup
estimated_time: 15 minutes
difficulty: intermediate
---

Getting every enrolled student into PickupRoster is the step that unlocks everything else — parent invites, dismissal schedules, the carline display, the daily pickup report. This guide walks through a full roster import from your Student Information System (SIS), whether you're using PowerSchool, Infinite Campus, Skyward, Blackbaud, or a plain CSV export from something else.

## Before you start

- You must be signed in as an **Owner** or **Admin**. Staff, Dispatcher, and Teacher roles cannot import rosters.
- Export a current roster from your SIS as **CSV** or **XLSX**. You need one row per student, with at least: first name, last name, grade, and homeroom teacher name (or homeroom code). Student ID and date of birth are optional but strongly recommended.
- On the District tier, imports are scoped to the currently selected school. Use the tenant switcher at the top-left to make sure you're importing into the right building before you upload.
- Close any roster you've edited in Excel and re-save as `.csv (UTF-8)`. Older ANSI-encoded CSVs drop accents and apostrophes on import — always re-save as UTF-8.
- If you already imported last year's roster, **do not delete it**. PickupRoster's import wizard will match and update existing students by ID or by name+grade, so re-running keeps parent links intact.

## 1. Open the roster importer

1. Sign in at `https://app.pickuproster.com`.
2. In the left sidebar, click **Students**.
3. In the top-right of the students page, click **Import roster**. You'll land on a three-step wizard titled **Import students**.

![Import wizard landing screen](/images/guides/importing-student-rosters-from-sis/step-1.png)

## 2. Upload your file

1. Click **Choose file** and select your CSV or XLSX. Maximum file size is **5 MB** (roughly 25,000 students). Split larger files by grade band if you exceed that.
2. PickupRoster scans the header row and previews the first 10 rows so you can confirm the file loaded correctly.
3. Click **Next: map columns**.

If the file looks scrambled — everything in one column, or non-English characters showing as `?` — the file isn't UTF-8. Cancel, re-save from Excel as **CSV UTF-8**, and try again.

## 3. Map columns

PickupRoster will auto-detect common SIS column names (`student_first`, `LastName`, `Grade Level`, `HR Teacher`, etc.). Any column it isn't sure about shows a yellow **Needs mapping** badge.

1. For each required field — **First name**, **Last name**, **Grade**, **Homeroom** — pick the matching column from the dropdown.
2. Map optional fields if you have them: **Student ID**, **Date of birth**, **Dismissal group**, **Allergies/medical notes**.
3. Columns you leave unmapped are ignored on import. You can re-run the import later to add them.

![Column mapping screen](/images/guides/importing-student-rosters-from-sis/step-2.png)

Grade values are normalized automatically — `K`, `Kinder`, `Kindergarten`, and `00` all become **K**. Numeric grades like `01` and `1` both become **1**. If you use non-standard labels (Pre-K3, TK, Junior Kindergarten), add them under **Settings → Grades** before importing so the wizard has something to map to.

Click **Next: review**.

## 4. Review and import

The review screen shows a summary: how many rows will be **created**, **updated**, or **skipped**, plus a list of any rows with validation errors (missing last name, unknown homeroom teacher, duplicate student ID).

1. Scroll the **Errors** panel. Fix blocking issues by editing your source file and re-uploading — don't try to fix them inline, because partial imports are harder to audit than clean re-runs.
2. Unmatched homeroom teachers show under **New homerooms that will be created**. Review that list carefully: a typo like "Mrs. Smyth" vs. "Mrs. Smith" creates a duplicate homeroom you'll have to merge later.
3. When the summary looks right, click **Import N students**. The banner at the top shows live progress. A 2,000-student file typically takes **30–60 seconds**.

When it finishes, you'll see a toast confirming the count and a link to the roster activity log.

## 5. Verify and invite parents

1. Click **Students** again to see the full updated roster. Use the grade filter and homeroom filter to spot-check a few classes.
2. If the counts look correct, go to **Settings → Parent invites** to send invite links to families. Parents are matched to their children by the student ID or name+grade combination you just imported.

## Troubleshooting

**"Homeroom not found" errors.** PickupRoster expects homerooms to exist before students are assigned to them. Either pre-create them under **Students → Homerooms → New**, or check the box **Create missing homerooms** on step 4 and the importer will build them for you using the teacher name as the label.

**Duplicate students after import.** This happens when the same student appears under two different spellings and no Student ID is mapped. Go to **Students → Duplicates** to merge them, or re-export from your SIS with the student ID column included and re-run.

**Parent links broke after re-import.** Parent-student links are preserved only when **Student ID** is mapped. If you re-imported without it, open the activity log, click **Undo this import**, map the ID column, and run again.

**File won't upload.** Check that the file is under 5 MB and ends in `.csv` or `.xlsx` (not `.xls` or `.numbers`). If it still fails, try the CSV format — XLSX parsing is more fragile than CSV.

**Accented names show as garbled characters.** Your CSV isn't UTF-8. In Excel: **File → Save As → CSV UTF-8 (Comma delimited)**. In Google Sheets: **File → Download → Comma-separated values** (already UTF-8).

Once your roster is clean, move on to sending parent invite links so families can install the app and pick up where you left off.
