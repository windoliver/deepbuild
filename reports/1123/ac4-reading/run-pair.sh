#!/bin/bash
# #1123 AC4, a reading of the folders the change moves, before and after on one commit, in one checkout, so both
# sides share one fixed-path target. Before is the commit with the merge base's three runner files and the merge
# base's helpers of the two moved folders; after is the commit as it is. Three rounds, before then after.
# From a clean checkout, under one build grant:
#   node scripts/throttle.mjs build --wait 600 -- bash reports/1123/ac4-reading/run-pair.sh
# Every log is written here as it ends, with the checkout, the home folder and the machine's name left out.
set -u
WS=$(git rev-parse --show-toplevel) || exit 3
cd "$WS" || exit 3
OUT=$WS/reports/1123/ac4-reading
C=$(git rev-parse HEAD)
BASE=$(git merge-base HEAD origin/main)
T=${TMPDIR:-/tmp}
SWAP="scripts/lanes.mjs scripts/affected.mjs scripts/proof-runs.mjs tests/acceptance/374/helpers.ts tests/acceptance/375/helpers.ts"
redact() { sed -e "s#$WS#<checkout>#g" -e "s#$HOME#<home>#g" -e "s#$(hostname)#<host>#g"; }
put() {
  for f in $SWAP; do
    git show "$1:$f" > "$T/ac4-swap.$$" && cat "$T/ac4-swap.$$" > "$f" || { echo "BLOCKED: cannot write $f at $1"; exit 3; }
  done
  rm -f "$T/ac4-swap.$$"
}
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "BLOCKED: the checkout has uncommitted changes"; exit 3; }
trap 'put "$C"' EXIT
{
  date -u; uptime; sw_vers; sysctl -n machdep.cpu.brand_string hw.ncpu hw.memsize
  node --version; cargo --version; rustc --version
  echo "commit $C"; echo "base $BASE"; echo "throttle grant ${DEEP_THROTTLE%%:*}"
  echo "swapped on the before side: $SWAP"
} 2>&1 | redact > "$OUT/meta.txt"
# Warm the fixed-path target for the three binaries the eight files spawn, outside any reading.
SECONDS=0
cargo build --locked --bin deep-canvas-render --bin deep-layout --bin deep-text > "$T/ac4-warm.$$" 2>&1
{ echo "warm build exit $?, ${SECONDS} s"; tail -n 4 "$T/ac4-warm.$$"; } | redact > "$OUT/warm.txt"
rm -f "$T/ac4-warm.$$"
for round in 1 2 3; do
  put "$BASE"
  { uptime; node "$OUT/driver.mjs" before "$round"; echo "exit $?"; } 2>&1 | redact > "$OUT/before-$round.txt"
  put "$C"
  { uptime; node "$OUT/driver.mjs" after "$round"; echo "exit $?"; } 2>&1 | redact > "$OUT/after-$round.txt"
done
put "$C"
git diff --quiet HEAD -- $SWAP && echo "the five swapped files read as the commit's again" > "$OUT/restored.txt"
date -u > "$OUT/done.txt"
