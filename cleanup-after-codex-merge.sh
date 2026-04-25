#!/usr/bin/env bash
# Cleanup script for /Users/noah/personal/dev/school-organizer
# Run this AFTER the agent finishes the codex merge into master.
# The agent's bash sandbox can't unlink files in this repo, so it left
# some scratch files behind. This script removes them.
#
# Usage: bash cleanup-after-codex-merge.sh
# Or just copy/paste the commands one by one.

set -euo pipefail

cd "$(dirname "$0")"

echo "==> Removing sandbox-leftover lock files"
find .git -name "*.stale.*" -type f -print -delete 2>/dev/null || true
find .git -name "index.lock.bak*" -type f -print -delete 2>/dev/null || true
rm -f .git/refs/heads/master.test 2>/dev/null || true

echo "==> Removing my archived-refs scratch dir + packed-refs backup"
rm -rf .git/archived-refs 2>/dev/null || true
rm -f .git/packed-refs.old.archived 2>/dev/null || true

echo "==> Pruning dead worktree metadata (the .codex/worktrees dirs are gone)"
git worktree prune -v 2>/dev/null || true

echo "==> Current branch + master sha"
git branch --show-current
git rev-parse --verify master

echo
echo "==> What master looks like now (top 6 commits):"
git log --oneline master -6

echo
echo "==> Working tree status"
echo "If you see modified files matching the i18n WIP, those are already"
echo "captured in commit b69ea19 inside the merge. To reset the working"
echo "tree to match master HEAD, run:  git checkout -f master"
git status --short | head -20

echo
echo "Done."
