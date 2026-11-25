#!/bin/bash
# Diagnostic: 22ah's e2e-app again, with deep-app's window kept frontmost, to test whether its window only stops redrawing while covered.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/r22ah; O=~/mac-runs/out-22ah/rerun-front
mkdir -p "$O/e2e"; cd "$C" || exit 1
( while [ ! -f "$O/.done" ]; do osascript -e 'tell application "System Events" to if exists (first process whose name is "deep-app") then set frontmost of (first process whose name is "deep-app") to true' >> "$O/front-loop.txt" 2>&1; echo "$(date +%H:%M:%S) $(lsappinfo info -only name "$(lsappinfo front)" | sed -n 's/^"\(.*\)".*/\1/p')" >> "$O/front-samples.txt"; sleep 1; done ) &
E2E_OUT="$O/e2e" npx vitest run --root target/e2e-22 app.test.ts --testTimeout=1200000 > "$O/e2e/vitest.txt" 2>&1; echo "app exit=$? $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)" >> "$O/exits.txt"
touch "$O/.done"; wait; echo DONE >> "$O/exits.txt"
