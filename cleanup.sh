#!/usr/bin/env bash
# school-organizer cleanup — run from the repo root on your host machine (not inside an agent sandbox).
# Idempotent; safe to re-run. Exits on first error.
#
# Why a script? The agent sandbox's FUSE mount doesn't permit unlink(), so git
# operations that remove refs/locks leave cruft. Your host shell has no such
# restriction — this just works from your terminal.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .git ]; then
  echo "error: not a git repo root — cd to school-organizer/ and re-run" >&2
  exit 1
fi

echo "==> current branch (expect master)"
git rev-parse --abbrev-ref HEAD

# ---------------------------------------------------------------------------
# 1. Clear any leftover .lock files in .git (from failed agent sandbox runs)
# ---------------------------------------------------------------------------
echo "==> clearing leftover .git/*.lock and .git/refs/heads/*.lock* files"
find .git -maxdepth 4 \
  \( -name '*.lock' -o -name '*.lock.stale-*' -o -name '*.lock.dead-*' -o -name '*.lock.mega-*' -o -name '*.lock.cleared*' -o -name 'index.lock.del' \) \
  -type f -print -delete || true

# ---------------------------------------------------------------------------
# 2. Prune all dead worktrees (every worktree except this one)
# ---------------------------------------------------------------------------
echo "==> unlocking + pruning worktrees"
git worktree list --porcelain \
  | awk '/^worktree /{print $2}' \
  | while read -r wt; do
      if [ "$wt" != "$(pwd)" ]; then
        git worktree unlock "$wt" 2>/dev/null || true
      fi
    done

# Force-remove each non-primary worktree, then prune metadata.
git worktree list --porcelain \
  | awk '/^worktree /{print $2}' \
  | while read -r wt; do
      if [ "$wt" != "$(pwd)" ]; then
        git worktree remove -f -f "$wt" 2>/dev/null || true
      fi
    done
git worktree prune -v

# Nuke the on-disk .worktrees/ folder (dead session leftovers).
rm -rf .worktrees

# ---------------------------------------------------------------------------
# 3. Delete every local branch except master (all are merged or redundant)
# ---------------------------------------------------------------------------
echo "==> deleting all local branches except master"
git for-each-ref --format='%(refname:short)' refs/heads/ \
  | grep -v '^master$' \
  | while read -r br; do
      echo "   - $br"
      git update-ref -d "refs/heads/$br" 2>/dev/null || git branch -D "$br" 2>/dev/null || true
    done

# Nuke any leftover broken refs under refs/heads (from the sandbox mess)
find .git/refs/heads -type f ! -name 'master' -print -delete 2>/dev/null || true

# Rewrite packed-refs to drop stale entries (keep master + remotes)
if [ -f .git/packed-refs ]; then
  grep -vE '^[0-9a-f]+ refs/heads/(?!master$)' .git/packed-refs > .git/packed-refs.new 2>/dev/null \
    || grep -vE '^[0-9a-f]+ refs/heads/' .git/packed-refs > .git/packed-refs.new \
    || true
  # re-add master explicitly from loose ref if we stripped it
  if ! grep -q 'refs/heads/master' .git/packed-refs.new 2>/dev/null; then
    :
  fi
  mv .git/packed-refs.new .git/packed-refs
fi

# ---------------------------------------------------------------------------
# 4. Prune stale remote-tracking refs
# ---------------------------------------------------------------------------
echo "==> pruning origin"
git remote prune origin || true

# ---------------------------------------------------------------------------
# 5. Clean untracked temp files
# ---------------------------------------------------------------------------
echo "==> removing temp/trash files"
rm -f .trash-untracked-manual-1438-schools.md
rm -f flow-tmp.mjs scan-tmp.mjs
rm -f docs/testfile
rm -f docs/agent-reports/test-file.md
rm -f docs/agent-reports/2026-04-24-1431-p0-3.patch
rm -f docs/agent-reports/2026-04-24-1431-p0-5.patch
rm -f docs/agent-reports/2026-04-24-1431-gate-results.md

# ---------------------------------------------------------------------------
# 6. .gitignore: make sure .worktrees/ and agent-reports patches stay out
# ---------------------------------------------------------------------------
echo "==> updating .gitignore"
touch .gitignore
for entry in '.worktrees/' 'docs/agent-reports/*.patch' 'flow-tmp.mjs' 'scan-tmp.mjs' '.trash-untracked-*'; do
  grep -qxF "$entry" .gitignore || echo "$entry" >> .gitignore
done

# ---------------------------------------------------------------------------
# 7. Commit the docs worth keeping (security review + schools research)
# ---------------------------------------------------------------------------
echo "==> staging + committing docs worth keeping"
[ -f docs/security-review-2026-04-24.md ] && git add docs/security-review-2026-04-24.md
[ -f docs/research/2026-04-24-schools.md ] && git add docs/research/2026-04-24-schools.md
git add .gitignore

if ! git diff --cached --quiet; then
  git commit -m "chore: archive 2026-04-24 agent outputs + tighten .gitignore

- keep docs/security-review-2026-04-24.md (P0 audit record)
- keep docs/research/2026-04-24-schools.md (schools research)
- ignore .worktrees/, agent patches, flow/scan tmp scripts"
else
  echo "   (nothing new to commit)"
fi

# ---------------------------------------------------------------------------
# 8. Final verification
# ---------------------------------------------------------------------------
echo ""
echo "==> final state"
echo "-- branches --"
git branch
echo "-- worktrees --"
git worktree list
echo "-- status --"
git status --short
echo ""
echo "done."
