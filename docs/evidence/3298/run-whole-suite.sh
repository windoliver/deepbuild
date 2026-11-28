#!/usr/bin/env bash
# #3298: the before lane on main for #27's suite, each tag of interest mapped to the one twin under test.
# Runs on the Spark as a systemd user unit. Writes ~/runs/r3298/out/*.
set -u
. ~/.cargo/env
. ~/.nvm/nvm.sh >/dev/null
nvm use 24 >/dev/null
export PATH="$HOME/.local/bin:$PATH"
R=$HOME/runs/r3298
OUT=$R/out
mkdir -p "$OUT"
stamp() { echo "== $(date -u +%FT%TZ) $1 load: $(cut -d' ' -f1-3 /proc/loadavg) cores: $(nproc)" | tee -a "$OUT/steps.txt"; }
stamp start
cd "$R" || exit 1
if [ ! -d clone/.git ]; then
  git clone --quiet https://github.com/windoliver/deepbuild.git clone || { stamp clone-failed; exit 1; }
fi
cd clone
git fetch --quiet origin main && git checkout --quiet -B scratch-3298 origin/main
echo "main: $(git rev-parse origin/main)" | tee -a "$OUT/steps.txt"
stamp npm-ci
npm ci --no-audit --no-fund > "$OUT/npm-ci.txt" 2>&1 || { stamp npm-ci-failed; exit 1; }
stamp build
npm run build --workspaces > "$OUT/build.txt" 2>&1 || { stamp build-failed; exit 1; }
stamp cargo
node scripts/throttle.mjs build -- cargo build --locked -p deep-hook > "$OUT/cargo.txt" 2>&1 || { stamp cargo-failed; exit 1; }
# The scratch commit: the lane proves the issue its change names, so it says Part of #27. twins.json keeps only the
# three twins #3298 names, one per tag, so the lane's "failed on <twin>" line names that twin (with the real file,
# AC4's line names the first of four twins that fails the test).
cat > tests/acceptance/27/twins.json <<'EOF'
{
  "#27.6e863673": ["repeat-reaches-you"],
  "#27.e6116d56": ["answer-skips-held-stop"],
  "#27.ffbe7d6f": ["waiter-checks-every-5s"]
}
EOF
git -c user.name=scratch -c user.email=scratch@invalid commit --quiet -am "scratch: before lane for #3298 (never pushed)

Part of #27"
git show --stat HEAD > "$OUT/scratch-commit.txt"
stamp before
node scripts/proof.mjs before > "$OUT/before.txt" 2>&1
echo "exit $?" >> "$OUT/before.txt"
stamp done
