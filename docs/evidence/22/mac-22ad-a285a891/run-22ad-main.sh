#!/bin/bash
# Window suites 1172/panel and 1459/identifier on main's merge base 9550dc0f0, for round 22ad's comparison.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/main-22ad
O=~/mac-runs/out-22ad/main-9550dc0f
mkdir -p "$O"; cd "$C" || exit 1
front() { lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/^"\(.*\)".*/\1/p' | head -1; }
st() { echo "$* $(date +%H:%M:%S) load { $(sysctl -n vm.loadavg | tr -d '{}' | xargs) } free KB $(df -k /Users | awk 'NR==2{print $4}')" | tee -a "$O/exits.txt"; }
( while [ ! -f "$O/.done" ]; do echo "$(date +%H:%M:%S) $(front)"; sleep 2; done ) > "$O/front-samples.txt" &
st "head $(/usr/bin/git rev-parse HEAD)"
echo "== head $(/usr/bin/git rev-parse HEAD)" > "$O/suites.txt"
for f in tests/acceptance/1172/panel.test.ts tests/acceptance/1459/identifier.test.ts; do
  st "$f start: front app [$(front)]"
  echo; echo "===== $f start $(date +%H:%M:%S) front app [$(front)]" >> "$O/suites.txt"
  npx vitest run "$f" >> "$O/suites.txt" 2>&1; e=$?
  echo "===== $f exit=$e end $(date +%H:%M:%S) front app [$(front)]" >> "$O/suites.txt"
  st "$f exit=$e; front app [$(front)]"
done
touch "$O/.done"; wait
st "MAIN DONE"
