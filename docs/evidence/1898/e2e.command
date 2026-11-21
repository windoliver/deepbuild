#!/bin/bash
# #1898 hand e2e: a real dev hub with a loader log, one claim with a check of every kind, and deep lease (README.md).
# Needs the repo built (npm run build --workspaces) and target/debug/deep-hook (cargo build -p deep-hook).
printf '\033[8;56;176t'   # a window wide and tall enough for the whole report
D=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$D/../../.." && pwd)
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/sbin:$PATH
export E2E_LOG=${TMPDIR:-/tmp}/deep-e2e-1898.log
: > "$E2E_LOG"
cd "$R" && node node_modules/vitest/vitest.mjs run --config "$D/vitest.e2e.mjs" > "${E2E_LOG%.log}.vitest.txt" 2>&1
status=$?
clear
{
  echo "#1898 hand e2e at $(/usr/bin/git -C "$R" rev-parse --short HEAD), $(date '+%Y-%m-%d %H:%M'), $(uptime | sed 's/.*load/load/')"
  cut -c1-170 "$E2E_LOG"
  echo "vitest exit $status"
} | tee "${E2E_LOG%.log}.report.txt"
