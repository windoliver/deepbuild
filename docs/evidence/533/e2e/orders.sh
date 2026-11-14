# Criterion 2's check on a build: both arrival orders must write first = 1 at step 3 with equal hashes at every step.
# $@ is deep-logic's own arguments (none, or --planted <twin>). Run from the scratch folder. Exits 1 on FAIL.
set -euo pipefail
H='[.[] | select(.steps) | .steps[] | {step, first: .arrays["first.first"][0], hash: .items.first.hash}]'
A=$(bin/deep-logic "$@" < evin/players-2-then-1.in | jq -s -c "$H")
B=$(bin/deep-logic "$@" < evin/players-1-then-2.in | jq -s -c "$H")
jq -n -r -e --argjson a "$A" --argjson b "$B" '
  if ($a | map(.step)) != [0, 1, 2, 3, 4, 5] or ($b | length) != 6 then "FAIL: a run gave no steps 0 to 5" | halt_error(1) else . end |
  [range(0; $a | length) | select($a[.] != $b[.] or ($a[.].step == 3 and $a[.].first != 1))] as $bad
  | "  2 then 1, step 3: \($a[3] | tojson)\n  1 then 2, step 3: \($b[3] | tojson)\n  " +
    (if ($bad | length) == 0 then "PASS: first = 1 in both orders, and the \($a | length) step hashes are equal"
     else "FAIL at step \($a[$bad[0]].step): first is \($a[$bad[0]].first) and \($b[$bad[0]].first), wanted 1 and 1; hashes \($a[$bad[0]].hash) and \($b[$bad[0]].hash)" end),
    (if ($bad | length) == 0 then empty else ("" | halt_error(1)) end)'
