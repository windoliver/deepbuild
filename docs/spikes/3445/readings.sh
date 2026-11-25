#!/bin/sh
# Spike #3445: every timed reading, one after another under one timed grant of the machine's throttle, so no other
# grant is held while any of them runs:
#
#   node scripts/throttle.mjs timed --wait 60 -- sh docs/spikes/3445/readings.sh <builds> <staged packs> <copy of main> <copy with the epoch checks out> [suffix]
#
# <builds> holds build.sh's folders (stock, timing, parallel, parallel-timing); <staged packs> is `measure.mjs stage`'s
# folder; the two copies are built, the first at its commit and the second with patches/epochs-out.patch applied. A
# suffix keeps a second set of readings beside the first (out/first-reply-2.json, …). Each run records its own lease
# and its own load at its start and its end; a run that started or ended above the cores is a reading, not a result.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
BUILDS=$1
STAGED=$2
MAIN=$3
EPOCHS=$4
X=$5
M="node $HERE/measure.mjs"
O=$HERE/out
echo "lease ${DEEP_THROTTLE:-none}, load $(uptime | sed 's/.*averages: //')"
$M core --core "$BUILDS/stock/deep-show" --build "$BUILDS/stock/build.json" --root "$STAGED" --out "$O/first-reply$X.json"
$M core --core "$BUILDS/timing/deep-show" --build "$BUILDS/timing/build.json" --root "$STAGED" --out "$O/compile$X.json"
$M core --core "$BUILDS/parallel/deep-show" --build "$BUILDS/parallel/build.json" --root "$STAGED" --out "$O/parallel$X.json"
$M core --core "$BUILDS/parallel-timing/deep-show" --build "$BUILDS/parallel-timing/build.json" --root "$STAGED" --out "$O/parallel-compile$X.json"
$M bench --tree "$MAIN" --out "$O/epochs-in$X.json"
$M bench --tree "$EPOCHS" --out "$O/epochs-out$X.json"
$M tracker --bin "$BUILDS/stock/spike3445_tracker" --build "$BUILDS/stock/build.json" --out "$O/tracker$X"
# The benchmark once more a side, the other way round. analyze.mjs reads the first pair whose two runs each keep their
# five readings within 5% of their median, in this order; with no such pair the first stands and the answer isn't settled.
$M bench --tree "$EPOCHS" --out "$O/epochs-out-again$X.json"
$M bench --tree "$MAIN" --out "$O/epochs-in-again$X.json"
echo "done, load $(uptime | sed 's/.*averages: //')"
