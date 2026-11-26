#!/bin/bash
# Mac round 22ah for PR #2097 at dc12364fb, same parts as 22ab.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/r22ah
O=~/mac-runs/out-22ah
mkdir -p "$O/e2e" "$O/signin" "$O/issues"
cd "$C" || exit 1
H=dc12364fb210256310f18e31c2357a32f32f3818
front() { lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/^"\(.*\)".*/\1/p' | head -1; }
therm() { pmset -g therm 2>/dev/null | awk '/CPU_Speed_Limit/{print "speedlimit "$3}' | head -1; }
cond() { echo "$(pmset -g batt | head -1 | tr -d '\n'); front app [$(front)]"; }
st() { echo "$* $(date +%H:%M:%S) load { $(sysctl -n vm.loadavg | tr -d '{}' | xargs) } $(therm) free KB $(df -k /Users | awk 'NR==2{print $4}')" | tee -a "$O/exits.txt"; }

{ sysctl -n hw.model; sysctl -n machdep.cpu.brand_string; sw_vers; pmset -g batt | head -1; pmset -g | grep lowpowermode; rustc --version; echo "node $(node --version)"; system_profiler SPDisplaysDataType | grep -E 'Resolution|Looks like'; echo "free disk before $(df -k /Users | awk 'NR==2{print $4}') KB"; echo "start $(date '+%F %T') $(uptime)"; } > "$O/machine.txt" 2>&1

st "start; $(cond)"
st "head $(/usr/bin/git rev-parse HEAD); origin/main $(/usr/bin/git rev-parse origin/main); merge-base $(/usr/bin/git merge-base HEAD origin/main)"
ex=""; for n in 22 318 319 320 321; do gh issue view $n -R windoliver/deepbuild --json body -q .body > "$O/issues/$n.md"; ex="$ex $n:$?"; done
st "issue bodies fetched to files (issue:exit)$ex"
for n in 22 318 319 320 321; do st "issues/$n.md sha256 $(shasum -a 256 "$O/issues/$n.md" | cut -d' ' -f1) bytes $(wc -c < "$O/issues/$n.md" | xargs)"; done
st "judge copy checks: sha256 $(shasum -a 256 scripts/spine-22-mac-dc12364f.mjs | cut -d' ' -f1) diff-lines=$(/usr/bin/diff scripts/spine.mjs scripts/spine-22-mac-dc12364f.mjs | grep -c '^[<>]') reopen-early-return=$(grep -c '^function reopen(j) { return;' scripts/spine-22-mac-dc12364f.mjs) row22=$(grep -c "\[22, '$H'\]" scripts/spine-22-mac-dc12364f.mjs)"

# Part 1
st "part 1 start: $(cond)"
cargo test -p deep-app --lib > "$O/1a-deep-app-lib.txt" 2>&1; e=$?
st "1a-deep-app-lib.txt: cargo exit=$e; $(grep '^test result' "$O/1a-deep-app-lib.txt" | tail -1)"
cargo test -p deep-app --no-fail-fast > "$O/1b-deep-app-full.txt" 2>&1; e=$?
grep -E '^test .* FAILED$|^    [A-Za-z0-9_:]+$|--test [a-z0-9_]+' "$O/1b-deep-app-full.txt" > "$O/1b-failed-names.txt"
st "1b-deep-app-full.txt: cargo exit=$e; failing tests $(grep -cE '^test .* FAILED$' "$O/1b-deep-app-full.txt"); targets [$(grep -oE -- '--test [a-z0-9_]+' "$O/1b-deep-app-full.txt" | awk '{print $2}' | sort -u | xargs)]; front app [$(front)]"

# Setup
st "part setup start: $(cond)"
{ npm ci && npm run build --workspaces --if-present && cargo build --locked -p deep-hook; } > "$O/setup.txt" 2>&1; e=$?
st "setup (npm ci, workspace build, deep-hook) exit=$e"

# Part 2
mkdir -p target/e2e-22
cp docs/evidence/22/e2e-app.test.ts target/e2e-22/app.test.ts
cp docs/evidence/22/e2e-signin.test.ts target/e2e-22/signin.test.ts
st "part 2 start: $(cond)"
E2E_OUT="$O/e2e" npx vitest run --root target/e2e-22 app.test.ts --testTimeout=1200000 > "$O/e2e/vitest.txt" 2>&1; e=$?
st "part 2 app run: vitest exit=$e; PNGs $(ls "$O/e2e"/*.png 2>/dev/null | wc -l | xargs); front app [$(front)]"

# Part 3
st "part 3 start: $(cond)"
E2E_OUT="$O/signin" npx vitest run --root target/e2e-22 signin.test.ts --testTimeout=1200000 > "$O/signin/vitest.txt" 2>&1; e=$?
st "part 3 signin: vitest exit=$e; PNGs $(ls "$O/signin"/*.png 2>/dev/null | wc -l | xargs); front app [$(front)]"

# Part 4
echo "== head $H" > "$O/4-suites.txt"
for f in tests/acceptance/1459/identifier.test.ts tests/acceptance/1459/panel.test.ts tests/acceptance/1172/rows.test.ts tests/acceptance/1172/panel.test.ts tests/acceptance/1460/cli.test.ts; do
  n=${f#tests/acceptance/}; n=${n%.test.ts}
  st "part 4 $n start: $(cond)"
  echo; echo "===== $f start $(date +%H:%M:%S) front app [$(front)]" >> "$O/4-suites.txt"
  npx vitest run "$f" >> "$O/4-suites.txt" 2>&1; e=$?
  echo "===== $f exit=$e end $(date +%H:%M:%S) front app [$(front)]" >> "$O/4-suites.txt"
  st "$f exit=$e; front app [$(front)]"
done

# Part 5
echo "== head $H" > "$O/5-suites.txt"
s5() { # name, vitest args...
  local n=$1; shift
  st "part 5 $n start: $(cond)"
  echo; echo "===== $n start $(date +%H:%M:%S) front app [$(front)]"$'\n'"== command: NO_COLOR=1 npx vitest run $*" >> "$O/5-suites.txt"
  npx vitest run "$@" > "$O/5-$n.tmp" 2>&1; local e=$?
  cat "$O/5-$n.tmp" >> "$O/5-suites.txt"
  echo "===== $n exit=$e end $(date +%H:%M:%S) front app [$(front)]" >> "$O/5-suites.txt"
  st "$n exit=$e; $(grep -E '^ +Tests ' "$O/5-$n.tmp" | tail -1 | xargs); front app [$(front)]"
  rm -f "$O/5-$n.tmp"
}
s5 318 --root tests/acceptance/318 --no-file-parallelism
s5 319-budgets tests/acceptance/319/budgets.test.ts
s5 83-redraft-319 --root tests/acceptance/83/redraft-319 --no-file-parallelism
s5 1349 --root tests/acceptance/1349 --no-file-parallelism
s5 1345 --root tests/acceptance/1345 --no-file-parallelism

# Part 6
# Disk guard (PR session asked for 40 GB free before the judge): drop own incremental cache, then wait up to 60 min for 40 GB
rm -rf target/debug/incremental; st "disk guard: own incremental removed"
for i in $(seq 1 60); do [ "$(df -k /Users | awk 'NR==2{print $4}')" -ge 41943040 ] && break; [ $i = 1 ] && st "disk guard: under 40 GB, waiting"; sleep 60; done
st "disk guard done (40 GB = 41943040 KB)"
st "part 6 start: $(cond)"
for n in 22 318 319 320 321; do echo "$n $(DEEP_PROOF_ISSUES="$O/issues" node -e "import('./scripts/proof-change.mjs').then(m=>{const r=m.readIssue('.',{commits:[{message:'Closes #$n'}]});console.log(JSON.stringify(r).slice(0,90))})" 2>&1)"; done > "$O/readissue-precheck.txt"
st "readIssue pre-check lines $(wc -l < "$O/readissue-precheck.txt" | xargs), 'blocked' count $(grep -c blocked "$O/readissue-precheck.txt")"
st "status before the judge [$(/usr/bin/git status --porcelain | xargs)]"
probe() { echo "== $(date +%H:%M:%S) gh issue view 22 and 319 ($1)"; for n in 22 319; do gh issue view $n -R windoliver/deepbuild --json number,state,comments -q '{comments:(.comments|length),number,state}' ; echo "exit=$?"; done; }
probe "before the judge" >> "$O/gh-probe.txt"
st "gh probe before: $(tail -4 "$O/gh-probe.txt" | xargs)"
{ echo "== conditions at start: $(cond); $(uptime); no load wait"
  echo "== command: DEEP_PROOF_ISSUES=<issues folder> node scripts/spine-22-mac-dc12364f.mjs judge --issue 22 (copy: #22 pinned to $H, reopen() returns at once)"; } > "$O/judge.txt"
t0=$(date +%s)
DEEP_PROOF_ISSUES="$O/issues" node scripts/spine-22-mac-dc12364f.mjs judge --issue 22 > "$O/judge.out" 2> "$O/judge.err"; e=$?
t1=$(date +%s)
{ echo "== stdout:"; cat "$O/judge.out"; echo "== stderr (first 200 lines):"; head -200 "$O/judge.err"; echo "== exit=$e wall $((t1-t0)) s"; echo "== conditions at end: $(cond); $(uptime)"; } >> "$O/judge.txt"
st "judge exit=$e wall $((t1-t0)) s"
probe "after the judge" >> "$O/gh-probe.txt"
st "gh probe after: $(tail -4 "$O/gh-probe.txt" | xargs)"
/usr/bin/git status > "$O/git-status-after.txt" 2>&1
st "git status --porcelain lines after: $(/usr/bin/git status --porcelain | wc -l | xargs)"
{ echo "free disk after $(df -k /Users | awk 'NR==2{print $4}') KB"; echo "end $(date '+%F %T') $(uptime)"; } >> "$O/machine.txt"
st "ALL DONE"
