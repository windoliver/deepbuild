#!/usr/bin/env bash
# #3298 pass <label> <kept file>...: the before lane on main for #27 with every other #27-tagged file put on the
# byHand list of a scratch lanes.mjs, so the lane's one 20-minute vitest call holds only the kept files. Scratch only,
# never pushed. Reuses ~/runs/r3298/clone (built by r3298.sh).
set -u
. ~/.cargo/env
. ~/.nvm/nvm.sh >/dev/null
nvm use 24 >/dev/null
export PATH="$HOME/.local/bin:$PATH"
LABEL=$1; shift
R=$HOME/runs/r3298
OUT=$R/out
stamp() { echo "== $(date -u +%FT%TZ) $LABEL $1 load: $(cut -d' ' -f1-3 /proc/loadavg) cores: $(nproc)" | tee -a "$OUT/steps.txt"; }
cd "$R/clone" || exit 1
git checkout --quiet -B "scratch-3298-$LABEL" origin/main
cat > tests/acceptance/27/twins.json <<'EOF'
{
  "#27.6e863673": ["repeat-reaches-you"],
  "#27.e6116d56": ["answer-skips-held-stop"],
  "#27.ffbe7d6f": ["waiter-checks-every-5s"]
}
EOF
{
  echo
  echo "// scratch for #3298 pass $LABEL: every other #27-tagged file by hand, so the lane runs only the kept files"
  grep -vxF -f <(printf '%s\n' "$@") "$R/all-files.txt" | sed "s|.*|byHand.push('&');|"
} >> scripts/lanes.mjs
git -c user.name=scratch -c user.email=scratch@invalid commit --quiet -am "scratch: before lane for #3298, pass $LABEL (never pushed)

Part of #27"
git show HEAD > "$OUT/scratch-commit-$LABEL.txt"
stamp before
node scripts/proof.mjs before > "$OUT/before-$LABEL.txt" 2>&1
echo "exit $?" >> "$OUT/before-$LABEL.txt"
stamp done
