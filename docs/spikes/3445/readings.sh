#!/bin/sh
# Spike #3445: every timed reading, one after another under one timed grant of the machine's throttle, so no other
# grant is held while any of them runs:
#
#   node scripts/throttle.mjs timed --wait 60 -- sh docs/spikes/3445/readings.sh <builds> <staged packs> <copy of main> <copy with the epoch checks out> [suffix]
#
# <builds> holds build.sh's folders (stock, timing, parallel, parallel-timing); <staged packs> is `measure.mjs stage`'s
# folder; the two copies are built, the first at its commit and the second with patches/epochs-out.patch applied. A
# suffix keeps a second set of readings beside the first (out/first-reply-2.json, …). Each run records its own lease
# and its own load at its start and its end.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
BUILDS=$1
STAGED=$2
MAIN=$3
EPOCHS=$4
X=$5
M="node $HERE/measure.mjs"
O=$HERE/out
# A run counts only on mains power, with Low Power Mode off, in a nominal thermal state and at a load no higher than
# the machine's cores (the issue's Runs on: line; design: The reference Macs). So nothing is read off mains power or
# with Low Power Mode on; each run waits for the 1-minute load to fall under CALM; and a run that its own record says
# ran off those conditions is taken again, whatever it read, three times at most. With no calm within 10 minutes, or
# a run off them three times, nothing more is read and the exit is 3, so the grant goes back to the machine.
CORES=$(sysctl -n hw.ncpu)
CALM=${CALM:-15}
load() { sysctl -n vm.loadavg | awk '{print $2}'; }
mains() { pmset -g ps | grep -q "'AC Power'" && [ "$(osascript -l JavaScript -e 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.isLowPowerModeEnabled')" = false ]; }
calm() {
  mains || { echo "the Mac is off mains power, or Low Power Mode is on: nothing is read"; exit 3; }
  i=0
  while awk -v l="$(load)" -v c="$CALM" 'BEGIN { exit !(l >= c) }'; do
    [ $i -lt 60 ] || { echo "the load stayed at $(load), above $CALM, for 10 minutes"; exit 3; }
    sleep 10
    i=$((i + 1))
  done
}
loaded() { node -e 'const { load, fingerprint: f } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(load.start[0] > process.argv[2] || load.end[0] > process.argv[2] || f.power !== "ac" || f.lowPowerMode !== false || f.thermalState !== "nominal" ? 0 : 1)' "$1" "$CORES"; }
take() { # <the file that holds the run's load> <the run>
  f=$1
  shift
  n=0
  while :; do
    calm
    "$@"
    loaded "$f" || return 0
    n=$((n + 1))
    echo "taken again ($n): $(basename "$f") ran at a load above the $CORES cores, off mains power, with Low Power Mode on or hot"
    [ $n -lt 3 ] || { echo "$(basename "$f") ran off the conditions three times"; exit 3; }
  done
}
echo "lease ${DEEP_THROTTLE:-none}, load $(uptime | sed 's/.*averages: //')"
take "$O/first-reply$X.json" $M core --core "$BUILDS/stock/deep-show" --build "$BUILDS/stock/build.json" --root "$STAGED" --out "$O/first-reply$X.json"
take "$O/compile$X.json" $M core --core "$BUILDS/timing/deep-show" --build "$BUILDS/timing/build.json" --root "$STAGED" --out "$O/compile$X.json"
take "$O/parallel$X.json" $M core --core "$BUILDS/parallel/deep-show" --build "$BUILDS/parallel/build.json" --root "$STAGED" --out "$O/parallel$X.json"
take "$O/parallel-compile$X.json" $M core --core "$BUILDS/parallel-timing/deep-show" --build "$BUILDS/parallel-timing/build.json" --root "$STAGED" --out "$O/parallel-compile$X.json"
take "$O/epochs-in$X.run.json" $M bench --tree "$MAIN" --out "$O/epochs-in$X.json"
take "$O/epochs-out$X.run.json" $M bench --tree "$EPOCHS" --out "$O/epochs-out$X.json"
take "$O/tracker$X/writes-logic.json" $M tracker --bin "$BUILDS/stock/spike3445_tracker" --build "$BUILDS/stock/build.json" --out "$O/tracker$X"
# The benchmark once more a side, the other way round. analyze.mjs reads the first pair whose two runs each keep their
# five readings within 5% of their median, in this order; with no such pair the first stands and the answer isn't settled.
take "$O/epochs-out-again$X.run.json" $M bench --tree "$EPOCHS" --out "$O/epochs-out-again$X.json"
take "$O/epochs-in-again$X.run.json" $M bench --tree "$MAIN" --out "$O/epochs-in-again$X.json"
echo "done, load $(uptime | sed 's/.*averages: //')"
