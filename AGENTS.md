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

# Load CLOUDFLARE_API_TOKEN from the workspace's mise.toml so wrangler is
# authenticated for deploy:staging / d1:migrate:staging without the
# OAuth-interactive `wrangler login` (which wouldn't persist across sandbox
# sessions anyway). mise.toml lives at <workspace>/mise.toml, two levels
# above $REPO (<workspace>/dev/<repo>).
MISE_TOML="$(dirname "$(dirname "$REPO")")/mise.toml"
if [ -f "$MISE_TOML" ]; then
  tok=$(grep -E '^[[:space:]]*CLOUDFLARE_API_TOKEN[[:space:]]*=' "$MISE_TOML" \
        | head -1 | sed -E 's/^[^=]*=[[:space:]]*"?([^"[:space:]]+)"?.*$/\1/')
  [ -n "$tok" ] && export CLOUDFLARE_API_TOKEN="$tok"
fi

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


## Defensive patterns for unattended scheduled runs

Scheduled tasks run with no human at the keyboard, so anything that can
hang indefinitely — `npm ci`, `npx playwright install`, `git fetch` over
a flaky network, `wrangler deploy`, an interactive tool-approval prompt —
will eat the whole run. Two patterns that kill this failure mode:

### 1. Hard-timeout every long-running command

Never run an unbounded command. Wrap each one in GNU `timeout` with a
conservative upper bound. If the command times out, log it and either
retry once with backoff or exit to a clean failure state — never silently
hang. Example:

```bash
timeout 180 npm ci --prefer-offline \
  || { echo "FAIL: npm ci timed out or errored"; exit 1; }

timeout 90 git fetch origin --prune \
  || { echo "FAIL: git fetch timed out"; exit 1; }

timeout 600 npm run deploy:staging \
  || { echo "FAIL: staging deploy timed out"; exit 1; }
```

Rule of thumb: pick a timeout ≈ 3× the observed median runtime on a
healthy day. Typecheck: 120s. Unit tests: 300s. Staging deploy: 600s.
Playwright smoke: 600s.

### 2. Run the actual work in a fresh `/tmp` clone (not the shared fuse mount)

The session's mount of the workspace is a fuse filesystem that blocks
git's own `unlink()` on lock files — so a crashed or concurrent git
process leaves stale `.git/index.lock` entries that the next run can't
clear via `rm` (only `mv`, which git itself can't do). When two scheduled
tasks run at the same time, they fight for these locks and one or both
hangs. The entire problem disappears if the work happens in a local
`/tmp` clone:

```bash
# --- clean /tmp clone, bypass the fuse mount and its lock drama ---
WORKDIR="/tmp/so-$(date +%Y%m%d-%H%M)-$$"
rm -rf "$WORKDIR"
timeout 120 git clone --depth 1 https://github.com/nrsundberg/school-organizer.git "$WORKDIR" \
  || { echo "FAIL: clone timed out"; exit 1; }
cd "$WORKDIR"

# If you need a specific commit or branch:
# timeout 60 git fetch --depth 1 origin "$BRANCH" && git checkout "$BRANCH"

# Push back via HTTPS + CLOUDFLARE_API_TOKEN is for wrangler; for git push
# use the sandbox's SSH deploy key at "$REPO_FUSE/.git/agent_id_ed25519"
# or fetch a fresh PAT from mise.toml if you added one.
```

`/tmp` is local tmpfs inside the sandbox, not fuse — `rm -rf` works, git
locks release normally, and no other scheduled run can collide with you.
Only write back to the shared mount (`$REPO`) for files that need to be
visible to *other* agents (the scanner's report, the build's summary);
everything else stays in `/tmp` and is cleaned up when the session ends.

### 3. Delegate long chunks to sub-agents with built-in timeouts

If a step itself might loop (investigating a bug, running a full Playwright
matrix), spawn it as a sub-agent via the `Task` tool. Sub-agents return a
bounded result — if they hang, the parent gets the failure and can move
on; if they succeed, the parent keeps going. Without this, a single stuck
sub-step takes the whole session with it.

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

`playwright.staging.config.ts` defaults to
`https://staging.pickuproster.com` and accepts a `PLAYWRIGHT_BASE_URL`
override (e.g. the workers.dev fallback URL, or a per-tenant subdomain
like `https://demo.staging.pickuproster.com`). Both URLs resolve to the
same staging Worker — the apex is the primary because it exercises the
same Custom Domain + wildcard routing prod uses.

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

Staging runs at `https://staging.pickuproster.com` (apex + wildcard
`*.staging.pickuproster.com` for tenant subdomains, mirroring prod's
layout). The workers.dev URL `school-organizer-staging.<subdomain>.workers.dev`
also resolves to the same Worker as a fallback. Staging has its own D1
database, R2 bucket, rate limiter, and queue (separate namespace IDs
from production — see `wrangler.jsonc > env.staging`).

Before first deploy, the `staging` and `*.staging` DNS records in the
`pickuproster.com` Cloudflare zone must exist (proxied), or tenant
subdomain routing 404s.

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

**Mandatory: every `Agent`/`Task` subagent spawned from a main session
MUST be launched with `isolation: "worktree"`.** No exceptions for
"small" tasks, and no exceptions for read-only exploration — the cost
is a few seconds of worktree setup, the benefit is that sibling
subagents never race on `.git/index` and a cancelled subagent can
never leave a lock file in the shared checkout.

The harness creates the worktree, runs the subagent in it, and returns
the branch/path. The subagent should still run the gating (`typecheck`,
`test`, staging deploy + smoke) before reporting success. The main
session then does the merge using the returned branch.

If a task truly cannot be worktree-isolated (e.g., it must observe live
state in the main checkout), the main session performs it directly —
do not spawn a non-isolated subagent.

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
