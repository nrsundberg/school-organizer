---
title: "Uploading your school logo and setting brand colors"
date: 2026-04-22
slug: upload-school-logo-and-brand-colors
category: setup
estimated_time: 8 minutes
difficulty: beginner
---

Your school's logo and colors appear on the parent app, the carline display, email receipts, and the daily pickup report. Set them once here and every surface updates.

## Before you start

- You must be signed in as an **Owner** or **Admin** on your PickupRoster tenant. Staff and Dispatcher roles cannot change branding.
- Have your logo ready as a **PNG or SVG** file, at least **512 × 512 px**, under **2 MB**, with a transparent background.
- Know your primary brand color as a hex value (for example, `#0B4A8F`). If you only have a PDF style guide, open it and copy the hex from the color swatch page.
- On the District tier, branding is set **per school**. Make sure you have the right school selected in the tenant switcher at the top-left before continuing.

## 1. Open the branding settings

1. Sign in at `https://app.pickuproster.com`.
2. In the left sidebar, click **Settings**.
3. Click **Branding** in the settings submenu. You should land on a page titled **School Branding**.

![Branding settings screen](/images/guides/upload-school-logo-and-brand-colors/step-1.png)

## 2. Upload your logo

1. Under **School Logo**, click **Upload logo**.
2. Select your PNG or SVG file from your computer.
3. Drag the crop box to frame the logo. The preview on the right shows exactly how it will appear in the parent app header and on the carline display.
4. Click **Save logo**.

If the upload fails with "File too large," re-export your logo at 1024 × 1024 px or smaller. If you see "Unsupported file type," convert the file to PNG — JPGs are not accepted because they cannot render transparent backgrounds correctly on the dark carline display.

![Logo upload dialog](/images/guides/upload-school-logo-and-brand-colors/step-2.png)

## 3. Set your primary color

1. Scroll to the **Colors** section.
2. Click the color swatch next to **Primary**.
3. Paste your hex value into the input, or pick a color from the color wheel.
4. Click **Apply**.

The primary color is used for buttons, links, selected pickup zones, and the app header on mobile. Keep it dark enough to pass contrast on white — PickupRoster will show a small warning under the swatch if the color fails WCAG AA against white text.

## 4. Set your secondary color

1. Click the swatch next to **Secondary**.
2. Enter a hex value and click **Apply**.

Secondary is used for badges, chart accents, and the "on-campus" indicator chip. It is fine to use a lighter tint of your primary color here; a common choice is your primary color at roughly 30% lightness.

## 5. Preview on every surface

1. Click **Preview branding** at the top right of the Branding page.
2. Use the tabs at the top of the preview drawer to check each surface: **Parent app**, **Carline display**, **Email**, **Report PDF**.
3. On the **Carline display** tab, click **Toggle dark mode**. Your logo must still be legible against the dark background — if it is not, upload a second logo with a white fill in the **Dark-mode logo** slot just below the main logo field.

![Preview drawer showing all surfaces](/images/guides/upload-school-logo-and-brand-colors/step-3.png)

## 6. Publish the changes

1. Click **Publish changes** at the top right. You will see a confirmation banner: "Branding published. Updates are live now."
2. Parents with the app open will see the new branding on their next navigation. The carline display refreshes on its own every five minutes, or you can tap the gear icon on the display tablet and select **Refresh now**.

## 7. (Optional) Upload a favicon

1. Still on the Branding page, scroll to **Favicon**.
2. Click **Upload favicon** and select a 64 × 64 px PNG or ICO file.
3. Click **Save**.

The favicon is what appears on the browser tab when parents open the web app — worth setting if your school shares a generic domain with a district.

## Troubleshooting

**"Only admins can edit branding" banner.** Your account does not have Admin or Owner role. Ask your Owner to promote you via **Settings → Staff → Edit role**, or to make the branding change themselves.

**Logo looks blurry on the carline display.** The display runs at 1080p on most tablets. Re-upload your logo at 1024 × 1024 px or larger, and use SVG if you have it.

**Colors reverted to default after saving.** This usually means the hex value failed validation. Hex codes must be six characters and start with `#` — three-character shorthand like `#0B8` is not accepted. Retype the value and click **Apply** again.

**Color warning says "Fails contrast."** Your primary color is too light to use as a button background. Either darken it by 15–20% in the color picker, or ask your design team for a darker variant. PickupRoster will not block you from saving, but buttons may be hard to read for parents with low vision.

**Parents still see the old logo after publishing.** Their app has cached the previous asset. Updates propagate within 10 minutes; if a specific parent reports the issue after that, have them pull-to-refresh in the parent app or clear their browser cache.

**District admins: I changed branding and every school updated.** You were editing from the **District** scope instead of a specific school. Use the tenant switcher at the top-left to pick the individual school, then re-apply the branding for each school that should differ.
