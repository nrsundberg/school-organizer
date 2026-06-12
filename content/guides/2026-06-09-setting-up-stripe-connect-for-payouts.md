---
title: "Setting up Stripe Connect for Payouts"
date: 2026-06-09
slug: setting-up-stripe-connect-for-payouts
category: "setup"
estimated_time: "15 minutes"
difficulty: intermediate
---

## Before you start

- You must be a **School Admin** or **District Owner** on PickupRoster.
- Have your school's EIN (Employer Identification Number) or SSN ready — Stripe requires it to verify your identity before payouts can be enabled.
- Confirm your school's bank account and routing numbers are available.
- Only one Stripe Connect account can be linked per school. If your district has multiple schools, each school requires its own connection.

---

## Why Stripe Connect?

PickupRoster uses Stripe Connect to route optional parent fees (e.g., late-pickup charges, extended-care enrollment) directly to your school's bank account. Funds are held by Stripe and released on a rolling 2-day payout schedule after you complete onboarding.

---

## Steps

### 1. Open the Billing settings

1. Log in to PickupRoster and navigate to **Settings → Billing & Payments**.
2. In the **Payout Account** section, click **Connect with Stripe**.

You will be redirected to Stripe's hosted onboarding flow. PickupRoster does not see or store your bank credentials.

![Billing & Payments screen](/images/guides/setting-up-stripe-connect-for-payouts/step-1.png)

---

### 2. Create or sign in to a Stripe account

1. On the Stripe page, choose **Create account** if your school has no existing Stripe account, or **Sign in** if one already exists.
2. Enter the email address associated with your school's finance office — this is where Stripe will send payout notifications.
3. Click **Continue**.

> **Note:** If your district already uses Stripe for another purpose, use a different email or create a separate Stripe account for PickupRoster payouts to keep accounting clean.

---

### 3. Complete business verification

Stripe requires identity and business information to comply with financial regulations.

1. Select **Non-profit** or **Government entity** depending on your school's legal status. Most public K-12 schools choose **Government entity**.
2. Enter your school's **Legal business name** exactly as it appears on your EIN letter.
3. Enter your **EIN** in the Tax ID field.
4. Provide your school's **business address** (the mailing address on file with the IRS).
5. Add a **representative** — this is typically the principal or finance director. Stripe requires their legal name, date of birth, and last four digits of their SSN for identity verification.
6. Click **Continue**.

![Stripe business verification form](/images/guides/setting-up-stripe-connect-for-payouts/step-3.png)

---

### 4. Add your bank account

1. On the **Payout details** screen, click **Add bank account**.
2. Enter your school's **routing number** and **account number**.
3. Re-enter the account number to confirm.
4. Click **Save**.

Stripe may make a small test deposit (typically $0.01) within 1–2 business days to verify the account. Payouts will not begin until verification is complete.

---

### 5. Set statement descriptor and support contact

1. In the **Business details** section, set a **Statement descriptor** — this appears on parent bank statements. Use something recognizable like `LAKEVIEW SCHOOL`.
2. Add a **Support phone number** or email that parents can contact with billing questions.
3. Click **Continue**.

---

### 6. Review and submit

1. Review all entered information on the summary screen.
2. Agree to **Stripe's Connected Account Agreement**.
3. Click **Agree and submit**.

Stripe will review your application. Initial verification typically takes a few minutes; in some cases it can take up to 2 business days.

---

### 7. Confirm connection in PickupRoster

1. After submitting, Stripe redirects you back to PickupRoster.
2. In **Settings → Billing & Payments**, the **Payout Account** section should now show a green **Connected** badge and your Stripe account ID.
3. Click **Enable fee collection** to start accepting parent payments.

![Connected badge in PickupRoster](/images/guides/setting-up-stripe-connect-for-payouts/step-7.png)

---

## Troubleshooting

**"Stripe verification pending" badge won't clear**
Stripe occasionally requests additional documentation for certain entity types. Log in directly at [dashboard.stripe.com](https://dashboard.stripe.com), navigate to **Settings → Account details**, and check for any outstanding verification requests. Resolving them there will automatically update your status in PickupRoster within a few hours.

**Bank account verification failed**
Double-check that you entered the routing number first, then the account number (not reversed). If the test deposit never arrived after 3 business days, the account number may be incorrect — remove the account under **Settings → Billing & Payments → Payout Account → Manage** and re-add it.

**"Connect with Stripe" button is grayed out**
Your user role may not have billing permissions. Ask your District Owner to grant you the **Billing Manager** role under **Settings → Staff → Roles**.

**Parent payments are accepted but no payout has arrived**
Stripe holds the first payout for 7 days as a fraud-prevention measure. Subsequent payouts follow a 2-day rolling schedule. Verify your payout schedule under [dashboard.stripe.com → Payouts](https://dashboard.stripe.com).

**Error: "Your platform requires additional information"**
This appears when Stripe's requirements change (e.g., new KYC regulations). Visit **dashboard.stripe.com → Settings → Account details** and complete any new information requests.

---

*Last reviewed: 2026-06-09*
