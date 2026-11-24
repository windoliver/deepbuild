#!/bin/bash
# Mac round 22ag for PR #2097 at 9c7ecd658: setup, 319 budgets, judge.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"
export NO_COLOR=1
C=~/mac-runs/r22ag
O=~/mac-runs/out-22ag
mkdir -p "$O/issues"
cd "$C" || exit 1
H=9c7ecd658e4ed54d3ae7152b6191e2deeb95d4e5
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
st "judge copy checks: sha256 $(shasum -a 256 scripts/spine-22-mac-9c7ecd65.mjs | cut -d' ' -f1) diff-lines=$(/usr/bin/diff scripts/spine.mjs scripts/spine-22-mac-9c7ecd65.mjs | grep -c '^[<>]') reopen-early-return=$(grep -c '^function reopen(j) { return;' scripts/spine-22-mac-9c7ecd65.mjs) row22=$(grep -c "\[22, '$H'\]" scripts/spine-22-mac-9c7ecd65.mjs)"

# Setup
st "part setup start: $(cond)"
{ npm ci && npm run build --workspaces --if-present && cargo build --locked -p deep-hook; } > "$O/setup.txt" 2>&1; e=$?
st "setup (npm ci, workspace build, deep-hook) exit=$e"

# 319 budgets
st "319 budgets start: $(cond); $(pmset -g therm | tr "\n" " ")"
NO_COLOR=1 npx vitest run tests/acceptance/319/budgets.test.ts > "$O/319-budgets.txt" 2>&1; e=$?
st "319-budgets exit=$e; $(grep -E "^ +Tests " "$O/319-budgets.txt" | tail -1 | xargs); $(cond)"

# Part 6
st "part 6 start: $(cond)"
for n in 22 318 319 320 321; do echo "$n $(DEEP_PROOF_ISSUES="$O/issues" node -e "import('./scripts/proof-change.mjs').then(m=>{const r=m.readIssue('.',{commits:[{message:'Closes #$n'}]});console.log(JSON.stringify(r).slice(0,90))})" 2>&1)"; done > "$O/readissue-precheck.txt"
st "readIssue pre-check lines $(wc -l < "$O/readissue-precheck.txt" | xargs), 'blocked' count $(grep -c blocked "$O/readissue-precheck.txt")"
st "status before the judge [$(/usr/bin/git status --porcelain | xargs)]"
probe() { echo "== $(date +%H:%M:%S) gh issue view 22 and 319 ($1)"; for n in 22 319; do gh issue view $n -R windoliver/deepbuild --json number,state,comments -q '{comments:(.comments|length),number,state}' ; echo "exit=$?"; done; }
probe "before the judge" >> "$O/gh-probe.txt"
st "gh probe before: $(tail -4 "$O/gh-probe.txt" | xargs)"
{ echo "== conditions at start: $(cond); $(uptime); no load wait"
  echo "== command: DEEP_PROOF_ISSUES=<issues folder> node scripts/spine-22-mac-9c7ecd65.mjs judge --issue 22 (copy: #22 pinned to $H, reopen() returns at once)"; } > "$O/judge.txt"
t0=$(date +%s)
DEEP_PROOF_ISSUES="$O/issues" node scripts/spine-22-mac-9c7ecd65.mjs judge --issue 22 > "$O/judge.out" 2> "$O/judge.err"; e=$?
t1=$(date +%s)
{ echo "== stdout:"; cat "$O/judge.out"; echo "== stderr (first 200 lines):"; head -200 "$O/judge.err"; echo "== exit=$e wall $((t1-t0)) s"; echo "== conditions at end: $(cond); $(uptime)"; } >> "$O/judge.txt"
st "judge exit=$e wall $((t1-t0)) s"
probe "after the judge" >> "$O/gh-probe.txt"
st "gh probe after: $(tail -4 "$O/gh-probe.txt" | xargs)"
/usr/bin/git status > "$O/git-status-after.txt" 2>&1
st "git status --porcelain lines after: $(/usr/bin/git status --porcelain | wc -l | xargs)"
{ echo "free disk after $(df -k /Users | awk 'NR==2{print $4}') KB"; echo "end $(date '+%F %T') $(uptime)"; } >> "$O/machine.txt"
st "ALL DONE"
