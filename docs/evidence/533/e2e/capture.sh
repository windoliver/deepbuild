#!/usr/bin/env bash
# #533 end to end: each criterion's run through the built binaries, saved as a terminal screenshot in
# ../screens. $1 is a scratch folder holding bin/ (deep-logic and the deep-show builds, named
# deep-show-<features joined by +>) and evin/ (the inputs this folder's README lists, the evidence
# store under evin/store). Paths under it print as <scratch>, the store as <evidence>.
set -euo pipefail
S=$1
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../screens
shot() { python3 -I "$HERE/terminal.py" "$OUT/$1.png" "$2" "$S" "$3" > /dev/null; echo "$1.png"; }

# deep-logic's replies: an open's session, a step's records (step, t, arrays), the rest as they are.
LOGIC='if .session then {ok, session} elif .steps then {ok, step, steps: [.steps[] | {step, t, arrays}]} else . end'
shot c1-readings 'Criterion 1: a reading is recorded at the first step not yet run (the last call names an undeclared source and is refused)' \
  "bin/deep-logic < evin/readings.in | jq -c '$LOGIC'"
shot c2-players-2-then-1 'Criterion 2: two players press at step 3, player 2 arriving first' \
  "bin/deep-logic < evin/players-2-then-1.in | jq -c '$LOGIC'"
shot c2-players-1-then-2 'Criterion 2: the same presses, player 1 arriving first' \
  "bin/deep-logic < evin/players-1-then-2.in | jq -c '$LOGIC'"
shot c2-planted-arrival 'Criterion 2: planted read_region_orders_by_arrival (must differ)' \
  "bin/deep-logic --planted read_region_orders_by_arrival < evin/players-2-then-1.in | jq -c '$LOGIC'"
shot c2-planted-drops 'Criterion 2: planted read_region_drops_player: the first entry reads as player 0 (must differ)' \
  "bin/deep-logic --planted read_region_drops_player < evin/players-2-then-1.in | jq -c '$LOGIC'"
# e2e/order.wat writes, for the first four entries in its read region, each one's player and value.
ORDER='[.[] | select(.steps) | .steps[] | select(.step >= 3) | {step, order: .arrays["order.order"]}]'
shot c2-step-seq-order 'Criterion 2: entries arrive out of step and seq order; the read region holds [player, value] by step, player, seq; twins differ' \
  "for p in '' '--planted read_region_orders_by_arrival' '--planted read_region_drops_player'; do echo \"deep-logic \$p:\"; bin/deep-logic \$p < evin/seq-order.in | jq -s -c '$ORDER' || exit; done"

# deep-show's seal: logic@1's digest and implementation from the schedule, and the logic kit's verdict.
SEAL='if .ok == false then . else {ok, physics: (.replies[0].modules | index("physics") != null), logic_digest: .replies[0].digests.logic, implementation: (.replies[1].interfaces["logic@1"].implementation | {name, version, wasmtime: .pins.wasmtime.version}), kit: [.replies[2].modules[] | {module, verdict, interface, parts: (.parts | map({(.part): .verdict}) | add)}]} end'
shot c3-seal-shipped 'Criterion 3: the full build seals logic@1 and its kit passes' \
  "bin/deep-show-full run < evin/seal.json | jq -c '$SEAL'"
shot c3-seal-patch 'Criterion 3: a patch release (1.0.1) seals with the same digest; its kit adds the bit part, run for an implementation whose version differs from the reference' \
  "bin/deep-show-full+test-logic-patch run < evin/seal.json | jq -c '$SEAL'"
shot c3-seal-planted-control 'Criterion 3: control: planted digest_covers_version on shipped 1.0.0 seals (digest moves: the twin hashes the version)' \
  "bin/deep-show-full run --planted digest_covers_version < evin/seal.json | jq -c '$SEAL'"
shot c3-seal-planted 'Criterion 3: planted digest_covers_version: the patch release is refused' \
  "bin/deep-show-full+test-logic-patch run --planted digest_covers_version < evin/seal.json"

# deep-show without physics: the registry's modules, each document's issues, and eval's arrays.
NOPHYS='{ok, physics: (.replies[0].modules | index("physics") != null), logic: (.replies[0].modules | index("logic") != null), shown: [.replies[1:5][] | {outcome, issues: [.issues[]? | {code, path, what, why: [.actual.refusals?[]?.what]}]}], eval: [.replies[5:][] | .arrays]}'
shot c4-no-physics 'Criterion 4: a build without physics presents logic, refuses what needs physics' \
  "bin/deep-show-full+test-leave-out-physics run < evin/no-physics.json | jq -c '$NOPHYS'"
shot c4-full-control 'Criterion 4: control: the full build refuses the same two items for other reasons, with no module_missing' \
  "bin/deep-show-full run < evin/no-physics.json | jq -c '$NOPHYS'"
shot c4-no-physics-seal 'Criterion 4: the build without physics seals logic@1 and its kit passes' \
  "bin/deep-show-full+test-leave-out-physics run < evin/seal.json | jq -c '$SEAL'"
# The same calls through the full build: the flock's and the quiz's arrays are the same with and without physics.
EVAL='[.replies[5:][] | .arrays]'
shot c4-no-physics-vs-full 'Criterion 4: the flock and the quiz play the same without physics as with it' \
  "diff <(bin/deep-show-full run < evin/no-physics.json | jq -c '$EVAL') <(bin/deep-show-full+test-leave-out-physics run < evin/no-physics.json | jq -c '$EVAL') && echo 'same arrays in both builds:' && bin/deep-show-full run < evin/no-physics.json | jq -c '$EVAL'"
shot c4-needs-physics 'Criterion 4: a logic module that requires physics is refused at the seal' \
  "bin/deep-show-full+test-leave-out-physics+test-logic-needs-physics run < evin/seal.json"
