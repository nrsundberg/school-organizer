# Nightly Agent Summaries

Overnight autonomous agents write a summary here every run. Filename pattern:

- `YYYY-MM-DD-build.md` — 10 PM build agent
- `YYYY-MM-DD-polish.md` — 2 AM polish/test agent

Each summary links to the PR (if opened), branch name, files changed, tests run, and anything the agent flagged as needing Noah's attention.

**Review flow each morning:** skim the latest `-build.md` and `-polish.md`, open the draft PR(s) in GitHub, run CI if it hasn't already, merge the good ones, comment on the ambiguous ones.
