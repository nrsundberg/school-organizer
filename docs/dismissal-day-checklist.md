# Dismissal-Day Checklist — Front Desk

**Print this page. Keep a copy at the front desk and one with the
dismissal coordinator.** If the app is down during pickup, this is what
you do. One page on purpose.

---

## Monday morning (every week)

- [ ] Log in at `https://<your-school>.pickuproster.com/admin` and load
      the board. It should show today's date and your classes.
- [ ] Click **Print master list** (or go to `/admin/print/master`).
      Print **two copies** — one for the front desk, one for the
      dismissal coordinator.
- [ ] File last week's copies. The current week's master is the one you
      reach for in an outage.
- [ ] Put a fresh pen on the clipboard next to the printed list.

## Every day, 15 minutes before dismissal

- [ ] Load the admin board. Does it show today's students?
- [ ] Glance at the current master list on the clipboard — does it match
      Monday's printout, or have students moved spaces since? If you've
      had transfers, reprint.
- [ ] Make sure the dismissal coordinator has the master list in hand.

---

## If the app is down during dismissal

A fast mental check: is the page really not loading, or is it just slow?
Try hard-reload once. If it's been unresponsive for **more than 60
seconds**, assume the app is down and do this:

1. **Switch to paper.** Announce to staff: "We're on paper today." Read
    names off the printed master list as parents arrive.
2. **Write down what you dismiss.** Mark each student "out" on the paper
    list with a time. This is what we'll replay back into the app later.
3. **Call support.** Noah's phone number is on the same sheet as this
    checklist (front desk has it on the tape line). Tell him:
    - "Pickup Roster is down at [school name]."
    - What the screen looks like (blank page, error message, spinner).
    - The time the outage started.
4. **Email:** `support@pickuproster.com` with the same info if phone is
    slow. Subject line: `URGENT dismissal outage — [school]`.
5. **Keep dismissing.** Paper is the system of record for the rest of
    the day. Don't wait for the app to come back.

---

## After the outage

- [ ] Once the board loads again, open admin → History and re-enter the
      day's dismissals from your paper list. Take 10 minutes; it saves
      the nightly export.
- [ ] Reply to Noah's post-incident email with the timestamps you wrote
      on the paper list. He'll use those to update the reliability page.
- [ ] Reprint the master list for the next week.

---

## What "the app is down" looks like (so you don't guess)

| You see | It means | Do |
|---|---|---|
| Blank white page or "Application error" | Worker is down or redeploying | Switch to paper, call Noah |
| Board loads but student buttons do nothing when tapped | Websocket down — updates not syncing | Switch to paper, call Noah; you can still see the last state |
| "Gateway timeout" or "522" | Cloudflare / upstream issue | Switch to paper, call Noah |
| Page loads slow but works | Probably a slow cell signal — try WiFi | Keep using the app |
| You're logged out and can't log back in | Auth bug; not a full outage | Use paper list; report afterwards |

---

## Phone tree

- Noah Sundberg — [phone number on sticky note] — texts OK, calls faster
  if it's 3:00pm–4:00pm local time.
- Email: `support@pickuproster.com` (goes to Noah).
- The school's IT lead is not a Pickup Roster contact — don't wait on
  them before switching to paper.

---

## Why paper is the plan

The app runs on Cloudflare's network. It's reliable, but every cloud
service has bad minutes. Schools cannot have bad minutes at 3:00pm. The
printed master list exists because paper doesn't need a signal, a
password, or a battery. Keep it current and you'll never have a
dismissal you can't finish.

---

*This sheet is maintained by the Pickup Roster team. If something on it
is wrong for your school, email `support@pickuproster.com` and we'll fix
it in the next release.*
