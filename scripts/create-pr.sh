#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: bash scripts/create-pr.sh \"<title>\" [base-branch]" >&2
  echo "Pass PR body via stdin using a quoted heredoc." >&2
  echo "Example:" >&2
  echo "  bash scripts/create-pr.sh \"feat(ui): add install prompt\" <<'PR_BODY'" >&2
  echo "  ## Summary" >&2
  echo "  - Added install prompt flow" >&2
  echo "  PR_BODY" >&2
  exit 2
fi

if [[ -t 0 ]]; then
  echo "Error: PR body must be provided on stdin (use a quoted heredoc)." >&2
  exit 2
fi

title="$1"
base_branch="${2:-}"

cmd=(gh pr create --title "$title" --body-file -)
if [[ -n "$base_branch" ]]; then
  cmd+=(--base "$base_branch")
fi

"${cmd[@]}"
