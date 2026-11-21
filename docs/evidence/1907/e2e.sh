#!/bin/bash
# The #1907 hand e2e, as run for e2e-terminal.png: journey-e2e.mjs with the base's build and the change's build, the
# diff, then each build again (the noise check). usage: e2e.sh <base checkout, built> <change checkout, built>
# The base checkout borrows the change's node_modules for the run (only packages/checks-journey differs between them).
BASE=$1; CHANGE=$2; E=$(cd "$(dirname "$0")" && pwd); OUT=${TMPDIR:-/tmp}/e2e-1907
mkdir -p "$OUT"
echo "base  checkout: $(git -C "$BASE" rev-parse --short HEAD) $(git -C "$BASE" status --porcelain packages | wc -l | tr -d ' ') changed files in packages/"
echo "change checkout: $(git -C "$CHANGE" rev-parse --short HEAD) + $(git -C "$CHANGE" diff --name-only | tr '\n' ' ')"
[ -e "$BASE/node_modules" ] || ln -s "$CHANGE/node_modules" "$BASE/node_modules"
echo; echo "### base"; node "$E/journey-e2e.mjs" "$BASE" > "$OUT/base.out" 2>&1; echo "exit $?"; grep '^==' "$OUT/base.out"
echo; echo "### change"; node "$E/journey-e2e.mjs" "$CHANGE" > "$OUT/change.out" 2>&1; echo "exit $?"; grep '^==' "$OUT/change.out"
echo; echo "### diff base vs change (empty = identical)"; diff "$OUT/base.out" "$OUT/change.out" && echo "IDENTICAL: $(wc -l < "$OUT/change.out" | tr -d ' ') lines"
echo; echo "### change: verdict-bearing fields"; grep -E '"(outcome|message|kind|test)"' "$OUT/change.out" | head -20
echo; echo "### noise check: each build run again, compared with itself"
node "$E/journey-e2e.mjs" "$BASE" > "$OUT/base2.out" 2>&1; echo "base again exit $?"
node "$E/journey-e2e.mjs" "$CHANGE" > "$OUT/change2.out" 2>&1; echo "change again exit $?"
[ -L "$BASE/node_modules" ] && rm "$BASE/node_modules"
for pair in "base base2" "change change2" "base2 change2"; do set -- $pair; echo "--- $1 vs $2"; diff "$OUT/$1.out" "$OUT/$2.out" > /dev/null && echo same || diff "$OUT/$1.out" "$OUT/$2.out" | head -12; done
