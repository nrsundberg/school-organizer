---
title: "Password Reset Policies and Per-Tenant SSO (Microsoft Entra)"
date: 2026-06-23
slug: password-reset-policies-and-entra-sso
category: "setup"
estimated_time: "20 minutes"
difficulty: advanced
---

## Before you start

- You must be a **District Owner** or **School Admin** on PickupRoster. SSO configuration is only available to District Owners; School Admins can adjust password policy but not SSO.
- For SSO, you need **Global Administrator** or **Application Administrator** access in your Microsoft Entra (formerly Azure AD) tenant.
- Decide your approach before you start: password policy alone, SSO alone, or both. Most districts enable SSO for staff and keep password login for parents.
- Have one test staff account ready that is **not** your own. Never lock yourself out while testing.

---

## Part A — Password reset policies

Password policy applies per tenant (per school). District Owners can set a district-wide default and let individual schools override it.

### 1. Open the security settings

1. Log in to PickupRoster and navigate to **Settings → Security → Authentication**.
2. Select the **Password Policy** tab.

![Password policy tab](/images/guides/password-reset-policies-and-entra-sso/step-1.png)

### 2. Set the policy rules

1. Set **Minimum length** (default `10`, allowed range 8–64).
2. Toggle **Require mixed case**, **Require a number**, and **Require a symbol** as your district requires.
3. Set **Password expiry** in days. Enter `0` to disable expiry. We recommend `0` for parents and `90` for staff — set these per role using the **Apply to** dropdown.
4. Set **Reuse history** to block the last N passwords (default `5`).

### 3. Configure reset behavior

1. Under **Reset & Recovery**, set **Reset link lifetime** (default `60` minutes). Links are single-use and expire after this window.
2. Toggle **Lock account after failed attempts** and set the threshold (default `10`) and **Lockout duration** (default `15` minutes).
3. Click **Save policy**. Changes apply at each user's next login — active sessions are not forced to re-authenticate unless you click **Force re-login for all users**.

### 4. Send a manual reset (optional)

To reset a specific user without waiting for them:

1. Go to **Settings → Users**, find the person, and click **⋯ → Send password reset**.
2. PickupRoster emails a single-use link via Resend. The user does not see their old password.

---

## Part B — Per-tenant SSO with Microsoft Entra

SSO is configured per school tenant. If your district runs multiple schools under one Entra tenant, repeat the app-side steps for each school's unique callback URL, or use a single app registration with multiple redirect URIs.

### 5. Get your callback URL from PickupRoster

1. In PickupRoster, navigate to **Settings → Security → Single Sign-On**.
2. Click **Add provider → Microsoft Entra (OIDC)**.
3. Copy the **Redirect URI** shown — it looks like `https://app.pickuproster.com/auth/sso/<tenant-slug>/callback`. Keep this tab open.

![SSO provider setup](/images/guides/password-reset-policies-and-entra-sso/step-5.png)

### 6. Register the app in Microsoft Entra

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), go to **Identity → Applications → App registrations** and click **New registration**.
2. Name it `PickupRoster – <School Name>`.
3. Under **Supported account types**, choose **Accounts in this organizational directory only**.
4. Under **Redirect URI**, select platform **Web** and paste the URI you copied in step 5.
5. Click **Register**.

### 7. Create a client secret

1. In the new app, open **Certificates & secrets → New client secret**.
2. Add a description and set an expiry (Entra caps secrets at 24 months — calendar a renewal).
3. Click **Add**, then copy the secret **Value** immediately. It is shown only once.

### 8. Note the connection IDs

From the app's **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.

### 9. Finish the connection in PickupRoster

1. Return to the PickupRoster SSO tab from step 5.
2. Paste the **Application (client) ID**, **Directory (tenant) ID**, and **Client secret**.
3. Set **Domain restriction** to your staff email domain (e.g., `staff.yourdistrict.org`) so only matching accounts can use this provider.
4. Choose a **Login mode**:
   - **Optional** — staff can use SSO or password (recommended during rollout).
   - **Required** — password login is disabled for this domain; users must use SSO.
5. Click **Test connection**. PickupRoster runs a live OIDC handshake and reports success or the exact error.
6. Click **Save & enable**.

### 10. Verify with a test account

1. Open a private/incognito window and go to your school's login page.
2. Click **Sign in with Microsoft** and authenticate as your test staff user.
3. Confirm the user lands in PickupRoster with the correct role. Only after this succeeds, switch **Login mode** to **Required** if that's your goal.

---

## Troubleshooting

- **"Redirect URI mismatch" on test connection.** The URI in Entra must match the one from step 5 character-for-character, including the trailing path. Re-copy it; do not retype.
- **"AADSTS7000215: Invalid client secret."** The secret value was copied incorrectly or has expired. Generate a new secret (step 7) and paste the **Value**, not the Secret ID.
- **Staff can authenticate but get "No matching account."** The user's Entra email doesn't match an existing PickupRoster user or the domain restriction in step 9. Confirm the user exists under **Settings → Users** and that their email domain is allowed.
- **Locked out as admin.** District Owners always retain password login even when **Login mode** is **Required**. Use your password at `https://app.pickuproster.com/login` and the **Sign in with password** link.
- **Reset emails not arriving.** Check the user's spam folder, then verify your sending domain is verified under **Settings → Notifications → Email**. Reset links expire per step 3 — resend if past the window.
- **Secret expired in production.** SSO logins fail with a 401. Generate a new client secret in Entra and update it in PickupRoster step 9; no other fields change.
