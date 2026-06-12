# Fix Revoke Button and Accept-Invite Redirect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs from issue #59: (1) the Revoke button on uninvited users does nothing visually; (2) anonymous users on the marketing host are redirected to /login instead of seeing the accept-invite form.

**Architecture:**
Bug 1 — after revoking invite tokens, delete the never-activated user shell (mustChangePassword=true). The row disappears from the table, giving clear visual feedback. Bug 2 — `path-classification.ts` is missing `/accept-invite` in `anonSkipsViewer`, causing `enforceAnonymousAccess` to send anonymous visitors to `/login` because `org` is null on the marketing host. Add the flag and tests.

**Tech Stack:** React Router 7, Prisma/D1, Node `--test` suite, TypeScript

---

## Root-cause cheatsheet (read before touching code)

### Bug 1 — Revoke does nothing visually
In `app/routes/platform/users.tsx` the loader computes:
```ts
pending: u.mustChangePassword,   // stays true even after tokens revoked
```
`revokePendingInvites()` correctly stamps `revokedAt` on every token row, but
`mustChangePassword` is never cleared, so the row still renders with "Invite
pending" + Revoke/Resend buttons. The user looks stuck.

Fix: after revoking tokens for a user whose `mustChangePassword` is still
`true`, delete their shell (sessions → accounts → user). Row disappears →
clear visual confirmation.

The same pattern exists in `app/routes/platform/orgs.$orgId.tsx` for the
`"revoke-invite"` case, but its action already returns `{ ok: true }` and the
front-end JS re-fetches — still the same root cause, same fix.

### Bug 2 — Accept-invite → /login on marketing host
Anonymous user navigates to `pickuproster.com/accept-invite?token=...`.

In `resolve.server.ts → enforceAnonymousAccess`:
```ts
if (user || path.anonSkipsViewer) return;
// user=null, anonSkipsViewer=false  ← /accept-invite is not listed
const nextPath = `${url.pathname}${url.search}`;
if (path.isPlatform || !org) {          // org=null on marketing host
  throw redirect(`/login?next=...`);   // ← lands here
}
```
Invitee is bounced to `/login`, cannot enter a password (none was set), and
is stuck.

Fix: add `isAcceptInvite = pathname === "/accept-invite"` to
`path-classification.ts` and include it in `anonSkipsViewer`.

---

## File map

| File | Change |
|------|--------|
| `app/domain/request-scope/path-classification.ts` | Add `isAcceptInvite` flag, include in `anonSkipsViewer` |
| `app/domain/request-scope/path-classification.test.ts` | Add test for new flag |
| `app/routes/platform/users.tsx` | Delete user shell after revoking tokens |
| `app/routes/platform/orgs.$orgId.tsx` | Same deletion in revoke-invite case |

---

## Task 1 — Fix path classification for /accept-invite

**Files:**
- Modify: `app/domain/request-scope/path-classification.ts`
- Test: `app/domain/request-scope/path-classification.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `path-classification.test.ts` after the existing `set-password` test:

```ts
test("/accept-invite is anonymous-skippable (anon users can open invite links)", () => {
  assert.equal(
    marketing("/accept-invite").anonSkipsViewer,
    true,
    "marketing host: anon visitor must reach /accept-invite",
  );
  assert.equal(
    tenant("/accept-invite").anonSkipsViewer,
    true,
    "tenant host: same rule (belt-and-suspenders)",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/noah/personal/dev/school-organizer
npm test -- --test-name-pattern="accept-invite"
```

Expected: FAIL — `false` !== `true`

- [ ] **Step 3: Add `isAcceptInvite` to path-classification.ts**

In `classifyRequestPath`, after `const isPlatform = ...` (line ~57), add:

```ts
const isAcceptInvite = pathname === "/accept-invite";
```

In the `anonSkipsViewer` expression, add `isAcceptInvite ||` alongside the existing entries:

```ts
const anonSkipsViewer =
  isLogin ||
  isLogout ||
  isForgotPassword ||
  isResetPassword ||
  isViewerAccess ||
  isAuthApi ||
  isStatic ||
  isPublicApi ||
  isPublicMarketingPath ||
  isAcceptInvite;
```

Also add it to the return object:

```ts
return {
  isStatic,
  isSetPassword,
  isAcceptInvite,          // ← add this
  isApi,
  // ... rest unchanged
};
```

And add it to the `RequestPathClassification` type:

```ts
export type RequestPathClassification = {
  // ... existing fields ...
  /** True for /accept-invite — anonymous users must reach this page to complete their invite. */
  isAcceptInvite: boolean;
  // ... rest unchanged
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --test-name-pattern="accept-invite"
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add app/domain/request-scope/path-classification.ts app/domain/request-scope/path-classification.test.ts
git commit -m "fix(auth): exempt /accept-invite from anonymous-viewer redirect

Invite links always point to the marketing host (pickuproster.com).
enforceAnonymousAccess was redirecting unauthenticated visitors to
/login because org=null on the marketing host and /accept-invite was
not in anonSkipsViewer. Invitees hit /login with no password set.

Adds isAcceptInvite to anonSkipsViewer so the accept-invite loader
can validate and render the token form for unauthenticated users."
```

---

## Task 2 — Delete user shell after revoking on the platform users page

**Files:**
- Modify: `app/routes/platform/users.tsx` (action, revoke case — lines 125-129)

- [ ] **Step 1: Write the failing test**

This route is integration-tested via e2e or manually; there's no existing unit
test file for it. Verify the current behavior manually:

1. Start dev server: `npm run dev`
2. Navigate to `tome.localhost:5173/platform/users`
3. Invite a test user (any email)
4. Click "Revoke" on the pending row
5. Observe: row still shows "Invite pending" ← confirms the bug

- [ ] **Step 2: Update the revoke case in the action**

In `app/routes/platform/users.tsx`, replace the revoke block (lines 125-129):

**Before:**
```ts
if (intent === "revoke") {
  const userId = String(form.get("userId") ?? "");
  if (!userId) return data({ error: "Missing user." }, { status: 400 });
  await revokePendingInvites(context, userId);
  throw redirect("/platform/users");
}
```

**After:**
```ts
if (intent === "revoke") {
  const userId = String(form.get("userId") ?? "");
  if (!userId) return data({ error: "Missing user." }, { status: 400 });
  await revokePendingInvites(context, userId);
  // Delete the user shell — it was never activated (mustChangePassword=true)
  // and has no useful state. Deletion makes the row disappear immediately
  // rather than lingering as a ghost "Invite pending" entry.
  const db = getPrisma(context);
  const shell = await db.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true },
  });
  if (shell?.mustChangePassword) {
    await db.session.deleteMany({ where: { userId } });
    await db.account.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  throw redirect("/platform/users");
}
```

You also need to import `getPrisma` at the top of the file. Check line 1–15;
if it's not already there add:

```ts
import { getPrisma } from "~/db.server";
```

- [ ] **Step 3: Verify manually**

1. Navigate to `tome.localhost:5173/platform/users`
2. Invite a test user
3. Click "Revoke" on the pending row
4. Observe: row disappears from the table ← confirms the fix

- [ ] **Step 4: Commit**

```bash
git add app/routes/platform/users.tsx
git commit -m "fix(platform): delete user shell on invite revoke

After revoking invite tokens the row stayed visible as 'Invite pending'
because mustChangePassword was still true on the user record. Uninvited
users have no password and no data — delete them on revoke so the UI
clearly reflects the cancelled invitation."
```

---

## Task 3 — Delete user shell after revoking on the org detail page

**Files:**
- Modify: `app/routes/platform/orgs.$orgId.tsx` (action, revoke-invite case — lines 301-308)

- [ ] **Step 1: Locate the revoke-invite case**

Open `app/routes/platform/orgs.$orgId.tsx`. Find (around line 301):

```ts
case "revoke-invite": {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return data({ ok: false, error: "Missing user." }, { status: 400 });
  }
  await revokePendingInvites(context, userId);
  return data({ ok: true });
}
```

- [ ] **Step 2: Update the revoke-invite case**

Replace with:

```ts
case "revoke-invite": {
  const userId = String(formData.get("userId") ?? "");
  if (!userId) {
    return data({ ok: false, error: "Missing user." }, { status: 400 });
  }
  await revokePendingInvites(context, userId);
  const shell = await db.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true },
  });
  if (shell?.mustChangePassword) {
    await db.session.deleteMany({ where: { userId } });
    await db.account.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  return data({ ok: true });
}
```

Note: `db` is already in scope in this action — check the top of the action
handler for `const db = getPrisma(context)`. If it's not top-of-action, add it.

- [ ] **Step 3: Verify manually**

1. Navigate to a tenant org's detail page on the platform panel
2. Invite a test user to the org
3. Click "Revoke invite" on the pending row
4. Observe: row disappears or pending status clears

- [ ] **Step 4: Commit**

```bash
git add app/routes/platform/orgs.$orgId.tsx
git commit -m "fix(platform): delete user shell on org-level invite revoke

Same root cause as the platform-users revoke bug: uninvited user shells
with mustChangePassword=true lingered after token revocation. Delete on
revoke so the UI reflects the cancellation immediately."
```

---

## Self-review

**Spec coverage:**
- ✓ Revoke button fixed (Tasks 2 + 3)
- ✓ Accept-invite accessible on marketing host (Task 1)
- ✓ Tests for path classification change

**Placeholder scan:** none — all code blocks are complete.

**Type consistency:** `isAcceptInvite` field added to both the type definition and the return object. `getPrisma` import confirmed needed in users.tsx.

**Edge cases confirmed safe:**
- If the user accepted their invite before a race-condition revoke (mustChangePassword=false), the shell is NOT deleted — guarded by `if (shell?.mustChangePassword)`.
- If the userId doesn't exist, `findUnique` returns null → `if (shell?.mustChangePassword)` is false → no delete attempt, no error.
