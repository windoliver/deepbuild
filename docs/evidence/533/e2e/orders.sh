# Criterion 2's check on a build: both arrival orders must write first = 1 at step 3 with equal hashes at every step.
# $@ is deep-logic's own arguments (none, or --planted <twin>). Run from the scratch folder.
H='[.[] | select(.steps) | .steps[] | {step, first: .arrays["first.first"][0], hash: .items.first.hash}]'
A=$(bin/deep-logic "$@" < evin/players-2-then-1.in | jq -s -c "$H")
B=$(bin/deep-logic "$@" < evin/players-1-then-2.in | jq -s -c "$H")
jq -n -r --argjson a "$A" --argjson b "$B" '
  [range(0; $a | length) | select($a[.] != $b[.] or ($a[.].step == 3 and $a[.].first != 1))] as $bad
  | "  2 then 1, step 3: \($a[3] | tojson)\n  1 then 2, step 3: \($b[3] | tojson)\n  " +
    (if ($bad | length) == 0 then "PASS: first = 1 in both orders, and the \($a | length) step hashes are equal"
     else "FAIL at step \($a[$bad[0]].step): first is \($a[$bad[0]].first) and \($b[$bad[0]].first), wanted 1 and 1; hashes \($a[$bad[0]].hash) and \($b[$bad[0]].hash)" end)'
