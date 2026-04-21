#!/usr/bin/env bash
set -euo pipefail

# Run the engine + PWA locally against a /tmp workspace. No Docker.
# Flags:
#   --engine   only the engine
#   --ui       only the PWA
#   --reset    wipe the /tmp workspace before starting
#   --help     this text

WORKTREE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$WORKTREE_ROOT/../../.." && pwd)"

: "${MINION_WORKSPACE:=/tmp/minion-workspace}"
: "${DEFAULT_REPO:=$REPO_ROOT}"
: "${CORS_ALLOWED_ORIGINS:=http://localhost:3000}"
: "${ENABLE_BROWSER_MCP:=false}"
: "${ENABLE_CONTEXT7_MCP:=false}"
: "${ENABLE_GITHUB_MCP:=false}"
: "${ENABLE_SUPABASE_MCP:=false}"

TOKEN_FILE="$MINION_WORKSPACE/.minion-token"

mode="both"
reset="false"
for arg in "$@"; do
  case "$arg" in
    --engine) mode="engine" ;;
    --ui) mode="ui" ;;
    --reset) reset="true" ;;
    --help|-h)
      sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg"; exit 2 ;;
  esac
done

if [[ "$reset" == "true" ]]; then
  echo "wiping $MINION_WORKSPACE"
  rm -rf "$MINION_WORKSPACE"
fi

mkdir -p "$MINION_WORKSPACE"

if [[ ! -f "$TOKEN_FILE" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16 > "$TOKEN_FILE"
  else
    head -c 32 /dev/urandom | xxd -p -c 32 > "$TOKEN_FILE"
  fi
fi
TOKEN="$(cat "$TOKEN_FILE")"

export WORKSPACE_ROOT="$MINION_WORKSPACE"
export MINION_DB_PATH="$MINION_WORKSPACE/engine.db"
export DEFAULT_REPO
export MINION_API_TOKEN="$TOKEN"
export CORS_ALLOWED_ORIGINS
export ENABLE_BROWSER_MCP ENABLE_CONTEXT7_MCP ENABLE_GITHUB_MCP ENABLE_SUPABASE_MCP

echo "── minion-local ──────────────────────────────────────────────"
echo "  workspace : $MINION_WORKSPACE"
echo "  repo      : $DEFAULT_REPO"
echo "  token     : $TOKEN"
echo "  PWA URL   : http://localhost:3000"
echo "  engine URL: http://localhost:8080"
echo "──────────────────────────────────────────────────────────────"

cd "$WORKTREE_ROOT"

if [[ "$mode" == "engine" ]]; then
  exec bun --hot run server/index.ts
elif [[ "$mode" == "ui" ]]; then
  exec npm run dev:ui
else
  exec npx concurrently -n ui,server -c cyan,magenta "npm run dev:ui" "bun --hot run server/index.ts"
fi
