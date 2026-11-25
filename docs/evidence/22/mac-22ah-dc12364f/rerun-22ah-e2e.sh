#!/bin/bash
# Rerun 22ah's e2e-app and sign-in at low load, to tell window lag from a regression.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/r22ah; O=~/mac-runs/out-22ah/rerun
mkdir -p "$O/e2e" "$O/signin"; cd "$C" || exit 1
front() { lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/^"\(.*\)".*/\1/p' | head -1; }
st() { echo "$* $(date +%H:%M:%S) load { $(sysctl -n vm.loadavg | tr -d '{}' | xargs) } front [$(front)]" | tee -a "$O/exits.txt"; }
st "rerun head $(/usr/bin/git rev-parse HEAD)"
E2E_OUT="$O/e2e" npx vitest run --root target/e2e-22 app.test.ts --testTimeout=1200000 > "$O/e2e/vitest.txt" 2>&1; st "rerun app exit=$?"
E2E_OUT="$O/signin" npx vitest run --root target/e2e-22 signin.test.ts --testTimeout=1200000 > "$O/signin/vitest.txt" 2>&1; st "rerun signin exit=$?"
st "RERUN DONE"
