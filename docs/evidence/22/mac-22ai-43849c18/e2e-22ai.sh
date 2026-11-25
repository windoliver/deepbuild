#!/bin/bash
# Round 22ai e2e-app with deep-app kept frontmost (owner away, nothing typed). Starts once 22ai's 319 budgets are done.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/r22ai; O=~/mac-runs/out-22ai/e2e-front
until grep -q '319-budgets exit=' ~/mac-runs/out-22ai/exits.txt 2>/dev/null; do sleep 10; done
mkdir -p "$O/e2e"; cd "$C" || exit 1
mkdir -p target/e2e-22; cp docs/evidence/22/e2e-app.test.ts target/e2e-22/app.test.ts
echo "start $(date +%H:%M:%S) load $(sysctl -n vm.loadavg); judge may be running alongside (its setup/build phase)" >> "$O/exits.txt"
( while [ ! -f "$O/.done" ]; do osascript -e 'tell application "System Events" to if exists (first process whose name is "deep-app") then set frontmost of (first process whose name is "deep-app") to true' >> "$O/front-loop.txt" 2>&1; echo "$(date +%H:%M:%S) $(lsappinfo info -only name "$(lsappinfo front)" | sed -n 's/^"\(.*\)".*/\1/p')" >> "$O/front-samples.txt"; sleep 1; done ) &
E2E_OUT="$O/e2e" npx vitest run --root target/e2e-22 app.test.ts --testTimeout=1200000 > "$O/e2e/vitest.txt" 2>&1; echo "app exit=$? $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)" >> "$O/exits.txt"
touch "$O/.done"; wait; rm -f "$O/.done"; echo E2E-DONE >> "$O/exits.txt"
