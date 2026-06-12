---
title: "Parent Onboarding: Sending Invite Links"
date: 2026-05-28
slug: parent-onboarding-sending-invite-links
category: "setup"
estimated_time: "10 minutes"
difficulty: "beginner"
---

# Parent Onboarding: Sending Invite Links

Once your student roster is imported, the next step is getting parents into PickupRoster. Each parent needs an account tied to their student(s) so they can confirm pickup, request early dismissals, and receive live lane updates. This guide walks through bulk-sending invite links, monitoring acceptance, and resending to parents who never finished signup.

## Before you start

- Confirm your student roster is imported and visible under **Students → All Students**. If not, complete the SIS import guide first.
- Have at least one verified sender email configured under **Settings → Email**. The default `noreply@pickuproster.com` works, but a custom domain (e.g., `pickup@yourschool.edu`) gets significantly better open rates.
- Decide on your invite window. Most schools send invites 7–10 days before the policy takes effect, which gives parents time to install the mobile app without bombarding your support inbox the morning of go-live.
- You need the **Admin** or **Roster Manager** role to send invites. Teachers and Lane Staff cannot.

![Parent invites dashboard](/images/guides/parent-onboarding-sending-invite-links/step-1.png)

## Step 1 — Open the parent invites dashboard

From the main sidebar, click **Parents → Invites**. The dashboard shows three counters at the top: **Not invited**, **Invited (pending)**, and **Accepted**. The "Not invited" number is your starting audience.

If you just finished a roster import, every parent contact on those student records will appear here as "Not invited."

## Step 2 — Review and clean contact data

Before sending, click **Filters → Missing email** to find parent records without a valid email address. SIS exports frequently lose secondary guardians or contain typos.

For each row with a missing or malformed email:

1. Click the parent name to open the contact panel.
2. Fix the email field or check **Guardian — no digital contact** to suppress them from invites.
3. Click **Save**.

Skipping this step is the single biggest cause of low acceptance rates. A 5-minute scrub here saves dozens of support tickets later.

## Step 3 — Customize the invite template

Click **Settings → Invite Email Template** in the top-right of the invites dashboard. The default template is workable, but a personalized note from the principal more than doubles open rates in our internal data.

Editable fields:

- **Subject line** (default: `Welcome to PickupRoster — finish setting up your {school_name} account`)
- **Header message** — 1–2 sentences from the school. Keep it short.
- **Signature** — principal or office name. Avoid generic "The Administration."

Click **Preview** to send yourself a test email before you save. Then click **Save Template**.

![Invite template editor](/images/guides/parent-onboarding-sending-invite-links/step-2.png)

## Step 4 — Send invites in batches

For schools under 300 families, send all invites in one batch. For larger schools or district rollouts, send in batches of 200–300 per day so your support team can absorb the questions.

1. From the invites dashboard, click **Select → Not invited** to select all uninvited parents.
2. If batching, use the checkboxes to limit selection (sort by last name and pick a range).
3. Click **Send Invites**.
4. Confirm the sending email address and template, then click **Send Now**.

Each parent receives an email with a unique signed link that expires after 14 days. Clicking the link opens a guided signup flow: name, password, mobile number, and consent for SMS lane updates.

## Step 5 — Monitor acceptance and resend

Return to **Parents → Invites** daily for the first week. Sort by **Invite sent** to see oldest-pending invites at the top.

To resend:

1. Filter by **Status: Pending** and **Invited > 5 days ago**.
2. Click **Select all visible**.
3. Click **Resend Invite**. The expiration window resets to 14 days from the resend date.

Target a 90% acceptance rate before your go-live date. Parents who still have not accepted by day 10 should be contacted by phone — they often have spam-filtered the email.

## Troubleshooting

**"Invite email never arrived"** — Check the parent's spam folder first. If not there, ask the parent to whitelist your sender domain and click **Resend Invite**. Recurring delivery failures usually point to an SPF/DKIM issue on a custom sender domain — verify under **Settings → Email → Domain Authentication**.

**"Link says expired"** — Invite links expire after 14 days. Use **Resend Invite** to issue a fresh one. The parent's previous signup progress is preserved.

**"Parent says they signed up but doesn't see their student"** — The parent likely created a standalone account at pickuproster.com instead of using the invite link. Open the parent's record, click **Merge with existing account**, and search by email. PickupRoster will combine the accounts and attach the student.

**"Bulk send is greyed out"** — You've hit the daily send cap (1,000 emails on the School tier, 5,000 on District). Wait for the rolling 24-hour window to clear, or split the batch across two days.

**"Wrong parent received the invite"** — Some SIS exports duplicate guardian emails across families. Open **Parents → Invites**, search by the email, and review every record returned. Detach the incorrect link via **Actions → Remove guardian**.

## What's next

Once acceptance crosses 80%, run a soft-launch dismissal: pick one grade level, enable PickupRoster for that group only, and validate the lane flow before opening it to the whole school. See the upcoming guide on **Creating recurring dismissal schedules** to set this up.
