---
title: "Inviting staff and setting admin roles"
date: 2026-04-23
slug: inviting-staff-and-setting-admin-roles
category: setup
estimated_time: 7 minutes
difficulty: beginner
---

PickupRoster is locked down by default — only the Owner who created the tenant can do anything until you invite your team. This guide walks you through adding staff, picking the right role, and handling the common hiccups (expired invites, wrong role, wrong school).

## Before you start

- You must be signed in as an **Owner** or **Admin**. Dispatcher and Staff roles cannot invite new users.
- Collect the work email address for each person you plan to invite. Personal addresses work too, but parent notifications from those users will be signed with their personal address — most schools prefer staff use their district email.
- Know which role each person needs. The four roles are: **Owner** (billing + everything), **Admin** (everything except billing and deleting the tenant), **Dispatcher** (run the carline, no settings access), **Staff** (read-only pickup board, can mark students as picked up).
- On the **District tier**, decide whether each invitee should have access to one school, several schools, or the whole district. You can change this later.

## 1. Open the staff page

1. Sign in at `https://app.pickuproster.com`.
2. In the left sidebar, click **Settings**.
3. Click **Staff & roles** in the settings submenu. You should land on a page titled **Staff**.

![Staff settings screen](/images/guides/inviting-staff-and-setting-admin-roles/step-1.png)

## 2. Send an invite

1. Click **Invite staff** at the top right.
2. Enter the person's email address. To invite several people at once, paste a comma- or newline-separated list — the dialog will split them for you.
3. Pick a role from the **Role** dropdown. The panel on the right shows exactly what that role can and cannot do; double-check before sending.
4. On the **District tier**, pick which schools this person can access under **School access**. "All schools" grants district-wide access — only use this for district admins and the superintendent's office.
5. (Optional) Type a short note in the **Message** field. Whatever you type is included in the invite email, under the button. Leave it blank to send the default copy.
6. Click **Send invite**.

![Invite staff dialog](/images/guides/inviting-staff-and-setting-admin-roles/step-2.png)

Each invitee gets an email from `invites@pickuproster.com` with a magic link. The link is valid for **7 days** and can only be used once. They click the link, set a password (or sign in with Microsoft Entra if your tenant has SSO configured), and land on the dashboard with the role you picked.

## 3. Confirm the invite was received

1. Back on the Staff page, look at the **Pending invites** section.
2. You should see the invitee's email and a timestamp. If the status is **Sent**, the email is on its way. If it stays on **Queued** for more than two minutes, see Troubleshooting below.
3. Once the invitee accepts the invite, they move from **Pending invites** into the main staff list with a green **Active** dot.

## 4. Change someone's role later

1. On the **Staff** page, find the person in the list.
2. Click the **⋯** menu on their row and pick **Edit role**.
3. Choose the new role and click **Save**. The change takes effect on their next page load — they do not need to sign out and back in.

## 5. Remove access

1. On the **Staff** page, click **⋯** on the person's row and pick **Remove from school**.
2. Confirm in the dialog. Their active session is killed immediately and their email is released so you can invite a new person at the same address.

Removing a staff member does **not** delete the data they created (pickup logs, notes on student records). Those stay attached to their name so your audit trail remains intact.

## 6. (District tier) Bulk-invite from a CSV

1. Click **Invite staff**, then switch to the **Bulk upload** tab at the top of the dialog.
2. Download the template CSV by clicking **Download template**. Columns: `email`, `role`, `schools` (comma-separated school codes, or `ALL`).
3. Fill out the CSV in Excel or Sheets, save as `.csv`, and drag it onto the upload area.
4. Review the preview — any rows with errors (bad email, unknown role, missing school) will be flagged in red with the reason.
5. Click **Send all**. PickupRoster throttles bulk invites to 25 emails per minute to stay under Resend's rate limits; you'll see a progress bar during the send.

## Troubleshooting

**Invite email never arrived.** Check the invitee's spam folder first — Resend delivery is near-instant but district spam filters sometimes quarantine new-domain senders. If it is not in spam after 10 minutes, go to **Pending invites**, click **⋯**, and pick **Resend invite**. If a second send also fails to land, your district may be blocking `pickuproster.com` — ask your IT team to allowlist `invites@pickuproster.com` and `notifications@pickuproster.com`.

**"Invite link expired" error.** Invite links are valid for 7 days. On the Staff page, go to **Pending invites**, click **⋯**, and pick **Resend invite** to issue a fresh link. The old link is invalidated immediately.

**Can't change Owner role.** Every tenant must have exactly one Owner. To transfer ownership, the current Owner opens **Settings → Billing → Transfer ownership** and picks another Admin. You cannot demote yourself if you are the only Owner.

**Person already has an account on another tenant.** That's fine. Accounts are scoped per-tenant, so the same email can belong to different schools with different roles. On sign-in they will see a tenant picker listing every school they belong to.

**Bulk CSV says "Unknown school code."** School codes are shown on **Settings → Schools** as a short three- or four-letter code next to each school name (e.g., `LIN` for Lincoln Elementary). Copy the code exactly — the importer is case-insensitive but does not tolerate trailing spaces. Use `ALL` for district-wide access.

**Dispatcher invited by mistake as Admin.** Edit their role (Step 4). Demoting an Admin to Dispatcher takes effect instantly and drops them out of any Settings pages they currently have open.
