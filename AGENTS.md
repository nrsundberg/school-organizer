# AGENTS.md — How agents work on this repo

Every autonomous agent (scheduled tasks, one-shot runs, subagents launched
from a main session) follows the same rules so that parallel work doesn't
collide and broken work never lands on `master`.

## The rule

**Never commit directly to `master`. Always work in a worktree on a
topic branch. Gate every auto-merge behind typecheck + tests + a
staging smoke check.**

## Why worktrees

Multiple agents can run concurrently in this repo (a nightly build, a
nightly polish, four Phase 2 subagents, a human-triggered one-shot).
If they share a working tree they clobber each other's files. Git
worktrees give each agent its own checkout of the same repo, sharing
the `.git/` object store but with an isolated working directory and
branch checked out.

## Creating a worktree — canonical Step 0

Every scheduled task's prompt should start with this block. Subagents
launched with `Agent(isolation: "worktree")` get this for free — skip
the manual steps.

```bash
# --- Step 0: set up an isolated worktree and clean any stale locks ---

# Dynamically locate the repo (session IDs change per scheduled run).
REPO=$(find /sessions -maxdepth 6 -name 'nightly-queue.md' -path '*/docs/*' \
        -not -path '*/node_modules/*' 2>/dev/null | head -1 | xargs dirname | xargs dirname)
cd "$REPO" || { echo "FATAL: repo not found"; exit 1; }

# Clear any stale locks from previous runs (fuse mount blocks unlink,
# so MV within the same filesystem, never rm).
for lock in .git/index.lock .git/HEAD.lock .git/refs/heads/*.lock \
            .git/refs/stash.lock* .git/objects/maintenance.lock; do
  [ -e "$lock" ] && mv "$lock" "$lock.dead-$(date +%s%N)" 2>/dev/null || true
done

# Freshen master and create an isolated worktree.
git fetch origin --prune
BRANCH="$AGENT_BRANCH_PREFIX/$(date +%Y-%m-%d-%H%M)"
WT="$REPO/.worktrees/$(basename "$BRANCH")"
git worktree add "$WT" -b "$BRANCH" origin/master
cd "$WT"

# From here on, $WT is your working directory. All writes stay isolated.
```

Your prompt should set `AGENT_BRANCH_PREFIX` at the top — e.g.
`nightly-build`, `nightly-polish`, `foundation`, `phase2-auth`.

## Gating auto-merge

Before merging the agent's branch back to `master`, **all three** must
pass. Skip any one and you're shipping a regression.

```bash
# --- Pre-merge gate ---
cd "$WT"

npm ci --prefer-offline
npm run typecheck || { echo "FAIL: typecheck"; exit 1; }
npm test          || { echo "FAIL: unit tests"; exit 1; }

# Deploy this branch to staging, then smoke-check.
npm run deploy:staging
npx playwright test e2e/smoke.spec.ts \
    --config=playwright.staging.config.ts \
    || { echo "FAIL: staging smoke"; exit 1; }
```

`playwright.staging.config.ts` points at
`https://school-organizer-staging.<subdomain>.workers.dev` via
`PLAYWRIGHT_BASE_URL` — create it alongside `playwright.config.ts`
with `use: { baseURL: process.env.PLAYWRIGHT_BASE_URL }`.

## Merging

Only after the gate passes:

```bash
# --- Merge back to master ---
cd "$REPO"  # main checkout, NOT the worktree

# Clear stale locks on the main checkout too (it may be idle but
# hold leftover state from earlier runs).
for lock in .git/index.lock .git/HEAD.lock .git/refs/heads/*.lock; do
  [ -e "$lock" ] && mv "$lock" "$lock.dead-$(date +%s%N)" 2>/dev/null || true
done

git fetch origin --prune
git checkout master
git pull --ff-only origin master

# Fast-forward if possible; fall back to merge commit for history.
if git merge-base --is-ancestor "origin/master" "$BRANCH"; then
  git merge --ff-only "$BRANCH"
else
  git merge --no-ff "$BRANCH" -m "merge: $BRANCH (auto-merged by agent)"
fi

git push origin master
```

**If any of typecheck / unit tests / staging smoke fail**, push the
branch anyway so a human can look at it:

```bash
git push -u origin "$BRANCH"
echo "BLOCKED: branch pushed for review, NOT merged."
```

## Cleanup

After a successful merge:

```bash
git worktree remove "$WT" --force
git branch -d "$BRANCH"
git push origin --delete "$BRANCH" 2>/dev/null || true
```

After a blocked run, leave the worktree in place so a human can `cd`
into it and finish the work.

## Staging infrastructure

Staging runs at `school-organizer-staging.<your-subdomain>.workers.dev`
and has its own D1 database, R2 bucket, rate limiter, and queue
(separate namespace IDs from production — see `wrangler.jsonc > env.staging`).

Before the first staging deploy, run (from a human shell with
wrangler auth):

```bash
wrangler d1 create school-organizer-staging
# paste the database_id into wrangler.jsonc > env.staging > d1_databases
wrangler r2 bucket create pickup-roster-org-branding-staging
wrangler queues create pickup-roster-email-staging
wrangler queues create pickup-roster-email-staging-dlq

npm run d1:migrate:staging
npm run deploy:staging
```

After that, any agent can `npm run deploy:staging` to ship its branch.

## Subagents (Agent tool)

When a main-session agent spawns subagents, use
`isolation: "worktree"` — the harness creates the worktree, runs the
subagent in it, and returns the branch/path. The subagent should still
run the gating (`typecheck`, `test`, staging deploy + smoke) before
reporting success. The main session then does the merge using the
returned branch.

## Main sessions (interactive Claude)

A Cowork session that's doing interactive work directly with a human
should commit to `master` only for small fixes (< 30 lines, or
well-understood bug fixes already discussed). Anything larger —
feature work, cross-file refactors, schema changes — should
branch-and-merge via the same pattern, either by the human running
`git checkout -b feature/X` up front, or by spawning a worktree
subagent.

## Known gotchas

- **Fuse mount blocks unlink.** Cannot `rm` files inside `.git/` or
  any tracked file when the Cowork sandbox is attached to the user's
  filesystem. Use `mv` within the same filesystem. `find ... -delete`
  fails for the same reason. See the lock-cleanup pattern above.
- **Cached node_modules across worktrees.** Worktrees share `.git/` but
  not `node_modules/`. Either run `npm ci` in each worktree, or
  symlink `node_modules` from the main checkout (faster but risks
  stale deps if the feature branch changes `package.json`).
- **Prisma generated client.** `npm run build` runs `prisma generate`
  which writes to `app/db/generated/`. That directory is gitignored,
  so each worktree needs its own generate pass. `npm ci && npx prisma
  generate` is enough.
- **Staging D1 schema drift.** Always `npm run d1:migrate:staging`
  before `deploy:staging` if migrations changed. The nightly prompt
  should do this unconditionally — it's idempotent.
