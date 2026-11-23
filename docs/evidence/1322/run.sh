#!/bin/bash
# The #1322 e2e hand run as recorded in run.txt and e2e-terminal.png (macOS: cp -c is an APFS clone). It clones the
# PR branch fresh from GitHub into a temp folder; run.txt was taken on the commit that added this script. Scripts beside it:
# e2e.mjs (the measureOnce cases) and twin-tally.mjs (judges the suite's run on each twin against twins.json).
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:/usr/bin:/bin:/usr/sbin:/sbin"
E="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/e2e-1322-run.XXXXXX")"
C="$W/clone"
T="$W/twin"
trap 'rm -rf "$W"' EXIT
git clone -q --branch claude/issue-1322-measureonce-v2 https://github.com/windoliver/deepbuild.git "$C" || exit 1
git -C "$C" fetch -q origin +refs/heads/main:refs/remotes/origin/main || exit 1
mkdir -p "$T"
cp "$C/tests/acceptance/1322/twins/timeout-group-left-running/scripts/benchmark.mjs" "$C/scripts/proof-approvals.mjs" "$T/"
clear
{
echo "#1322 e2e hand run of measureOnce (scripts/benchmark.mjs): fresh GitHub clone of claude/issue-1322-measureonce-v2"
echo "HEAD $(git -C "$C" log -1 --format='%h %s' | cut -c1-100)"
FIX=$(git -C "$C" merge-base --is-ancestor 8545c5bee HEAD && echo "in HEAD's history" || echo "MISSING")
BASE=$(git -C "$C" merge-base HEAD origin/main | cut -c1-9)
[ -n "$BASE" ] || exit 1
echo "Fix 8545c5bee (group kill): $FIX. Branch vs merge base $BASE: $(git -C "$C" diff --name-only "$BASE" HEAD | wc -l | tr -d ' ') files, $(git -C "$C" diff --name-only "$BASE" HEAD | grep -vc '^tests/acceptance/1322/') outside tests/acceptance/1322/"
echo "$(uname -sm), node $(node --version), $(date '+%Y-%m-%d %H:%M %Z')"
node "$E/e2e.mjs" "$C" "$T"
echo
echo "== Suites (node --test) on the clone"
cd "$C" || exit 1
for f in tests/benchmark.test.mjs 'tests/acceptance/1322/*.test.mjs'; do
  node --test "$f" > "$W/suite.log" 2>&1
  echo "  $f: exit $?, $(grep -e '^ℹ tests' -e '^ℹ pass' -e '^ℹ fail' "$W/suite.log" | sed 's/^ℹ //' | tr '\n' ',' | sed 's/,$//; s/,/, /g')"
done
echo "  clone after the runs: $(git -C "$C" status --porcelain | wc -l | tr -d ' ') files changed"
echo
echo "== The new suite on each twin of benchmark.mjs laid over a copy of the clone"
for tw in timeout-group-left-running overflow-group-left-running in-time-group-killed in-time-cpu-in-seconds; do
  rm -rf "$C-twin"; cp -cR "$C" "$C-twin"
  cp "$C/tests/acceptance/1322/twins/$tw/scripts/benchmark.mjs" "$C-twin/scripts/benchmark.mjs"
  cd "$C-twin" || exit 1
  node --test --test-reporter=tap 'tests/acceptance/1322/*.test.mjs' > "$W/suite.log" 2>&1
  node "$E/twin-tally.mjs" "$C/tests/acceptance/1322/twins.json" "$tw" "$W/suite.log" $?
  cd "$C" || exit 1
done
cd /tmp
} 2>&1 | tee "$W/run.log"
cp "$W/run.log" "$E/run-latest.log"
echo
read -r -t 120 -p "(hand run finished; this window closes in 2 min)" _
