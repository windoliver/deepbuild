#!/bin/bash
# Round 2, Defect 1: runs tests/acceptance/2365/probe/pass.mjs, as it stands, on a throwaway archive module under
# each Node build, three times each, every run in a fresh empty home under /tmp/dh2365-r2-home-* that is removed
# after it. Prints each run's exact command, its result line as the probe wrote it, and the three memory fields
# in MB. Run from the repo root:
#   [PROBE=<pass.mjs>] repair-evidence/round2/probe-runs.sh <archive-module.mjs> [HOLD_MS]
# PROBE names another copy of the probe: repair-evidence/round2/before/probe/pass.mjs is the probe as it was before
# the repair, byte for byte (it finds the repo root four folders up, as the suite's own does).
set -u
MODULE="$1"; HOLD="${2:-}"
PROBE="${PROBE:-tests/acceptance/2365/probe/pass.mjs}"
NODES=("$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin/node" "/opt/homebrew/bin/node")
for NODE_BIN in "${NODES[@]}"; do
  echo "== node $("$NODE_BIN" -v) ($NODE_BIN)"
  for k in 1 2 3; do
    home=$(mktemp -d /tmp/dh2365-r2-home-XXXXXX)
    echo "\$ ${HOLD:+HOLD_MS=$HOLD }PATH=$(dirname "$NODE_BIN"):/usr/bin:/bin node --expose-gc $PROBE <temp home> pass 1791190800000 --archive $MODULE"
    line=$(env ${HOLD:+HOLD_MS=$HOLD} PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin" node --expose-gc "$PROBE" "$home" pass 1791190800000 --archive "$MODULE" | grep '"at":"result"')
    echo "$line"
    echo "$line" | "$NODE_BIN" -e 'let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => { const r = JSON.parse(s); const mb = (n) => (n / 1e6).toFixed(1); console.log(`   run '"$k"': rssStart ${mb(r.rssStart)} MB, peakRss ${mb(r.peakRss)} MB, rise ${mb(r.rise)} MB (peakRss - rssStart = ${mb(r.peakRss - r.rssStart)} MB), error ${r.error}`); });'
    rm -rf "$home"
  done
done
echo "load averages: $(uptime | sed 's/.*load averages: //')"
