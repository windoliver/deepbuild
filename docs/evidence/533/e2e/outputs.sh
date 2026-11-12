#!/usr/bin/env bash
# #533: regenerates this folder's *.out.json(l) from its inputs through the built binaries. $1 is the scratch folder
# capture.sh takes (bin/, and evin/store as the evidence store); paths print as <scratch> and <evidence>.
set -uo pipefail
S=$1
D=$(cd "$(dirname "$0")/.." && pwd)
red() { sed -e "s#$S/evin/store#<evidence>#g" -e "s#$S#<scratch>#g"; }
show() { sed "s#<evidence>#$S/evin/store#g" "$D/$2" | "$S/bin/deep-show-$1" run "${@:4}" | red > "$D/$3"; }
for n in readings players-1-then-2 players-2-then-1 seq-order; do "$S/bin/deep-logic" < "$D/$n.in.jsonl" | red > "$D/$n.out.jsonl"; done
"$S/bin/deep-logic" --planted read_region_orders_by_arrival < "$D/players-2-then-1.in.jsonl" | red > "$D/players-2-then-1.planted-arrival.out.jsonl"
"$S/bin/deep-logic" --planted read_region_drops_player < "$D/players-2-then-1.in.jsonl" | red > "$D/players-2-then-1.planted-drops.out.jsonl"
show full seal.in.json seal-shipped.out.json
show full+test-logic-patch seal.in.json seal-patch.out.json
show full seal.in.json seal-shipped-planted.out.json --planted digest_covers_version
show full+test-logic-patch seal.in.json seal-patch-planted.out.json --planted digest_covers_version
show full+test-leave-out-physics no-physics.in.json no-physics.out.json
show full+test-leave-out-physics+test-logic-needs-physics seal.in.json needs-physics.out.json
