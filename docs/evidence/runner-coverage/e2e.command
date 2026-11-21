#!/bin/bash
# Hand e2e: the runner and the hub on one Claude Code version, through a real dev hub (`deep hub run --root`) with the
# shipped facts and a stand-in `claude` on the login PATH. Needs `npm run build --workspaces` and
# `cargo build --locked -p deep-hook`. Stops only the hubs it starts, by PID; removes its temp folders.
set -u
printf "\e[3;0;0t\e[8;30;150t"; clear
HERE=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$HERE/../../.." && pwd)
cd "$WT" || exit 1
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
for k in $(env | grep -oE '^(DEEP_|CLAUDE|CODEX_)[A-Za-z0-9_]*'); do unset "$k"; done
echo "== branch $(/usr/bin/git rev-parse --short HEAD): $(/usr/bin/git log -1 --format=%s)"
node --experimental-transform-types --no-warnings --import "$HERE/stub-vitest.mjs" "$HERE/e2e.mts"
echo "exit $?"
