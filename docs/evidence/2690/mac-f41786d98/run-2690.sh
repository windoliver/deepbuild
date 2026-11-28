#!/bin/bash
# Mac round for PR #2880 (#2690) at f41786d98, base = merge base 703ea8e49.
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin"
export RUSTUP_HOME=$HOME/.rustup CARGO_HOME=$HOME/.cargo
export NO_COLOR=1
R=~/mac-runs
O=$R/out-2690
H=f41786d98c41e8df09285e0cc6587e109c001f40
B=703ea8e49fcb84502acab9f3cef01851db8b0834
URL=https://github.com/windoliver/deepbuild
G=/usr/bin/git
rm -rf "$O"; mkdir -p "$O"
front() { lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/^"\(.*\)".*/\1/p' | head -1; }
st() { echo "$* $(date +%H:%M:%S) load { $(sysctl -n vm.loadavg | tr -d '{}' | xargs) } thermal $($R/thermal) free KB $(df -k /Users | awk 'NR==2{print $4}')" | tee -a "$O/exits.txt"; }
cnt() { grep -E '^ +Tests ' "$1" | tail -1 | xargs; }
ccnt() { grep '^test result' "$1" | tail -1; }
snaps() { # clone, dest: copy the three snapshots the headless test wrote
  local f; f=$(find "$1/target" "$1/crates" -path '*snapshots/needs-you.json' -newer "$O/.mark" 2>/dev/null | head -1)
  if [ -n "$f" ]; then mkdir -p "$2"; cp "$(dirname "$f")"/{needs-you,sidebar,session}.json "$2"/; echo "snapshots from ${f#$1/}"; else echo "no snapshots found"; fi
}
clone() { # dir, sha
  rm -rf "$1"
  $G clone -q "$URL" "$1" && $G -C "$1" fetch -q origin "$2" "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/claude/fix-2690-ask-row-word:refs/remotes/origin/claude/fix-2690-ask-row-word" && $G -C "$1" checkout -q --detach "$2"
}
setup() { ( cd "$1" && npm ci && npm run build --workspaces && cargo build --locked -p deep-hook ) > "$O/setup-$2.txt" 2>&1; }

{ sysctl -n hw.model; sysctl -n machdep.cpu.brand_string; sw_vers; pmset -g batt | head -1; rustc --version; echo "node $(node --version)"; echo "start $(date '+%F %T') $(uptime)"; } > "$O/machine.txt" 2>&1
st "start; cc --version exit $(cc --version >/dev/null 2>&1; echo $?); screen-lock flag $(ioreg -n Root -d1 | grep -c CGSSessionScreenIsLocked); $(pmset -g batt | head -1 | sed 's/^Now drawing from //'); front app [$(front)]"

# A. base
C=$R/d2690b
clone "$C" "$B"; e=$?
st "BASE clone at $($G -C "$C" rev-parse HEAD) exit=$e; origin/claude/fix-2690-ask-row-word $($G -C "$C" rev-parse origin/claude/fix-2690-ask-row-word); origin/main $($G -C "$C" rev-parse origin/main); merge-base $($G -C "$C" merge-base $H origin/main)"
$G -C "$C" checkout -q $H -- tests/acceptance/2690
$G -C "$C" status --porcelain > "$O/base-copied-tests.txt"
st "base copied tests: $(wc -l < "$O/base-copied-tests.txt" | xargs) changed paths (base-copied-tests.txt)"
setup "$C" base; e=$?
st "setup base (npm ci, workspace build, deep-hook) exit=$e"
cd "$C" || exit 1
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2690 --no-file-parallelism > "$O/base-2690.txt" 2>&1; e=$?
st "base-2690.txt: $(cnt "$O/base-2690.txt") exit=$e"
touch "$O/.mark"; sleep 1
cargo test --locked -p deep-replica --test headless replica_equals_live_tree > "$O/base-1459-ac6.txt" 2>&1; e=$?
st "base-1459-ac6.txt: $(ccnt "$O/base-1459-ac6.txt") exit=$e; $(snaps "$C" "$O/base-replica")"
cd "$R"; rm -rf "$C"; st "clone $C removed"

# B. fix
C=$R/d2690f
clone "$C" "$H"; e=$?
st "FIX clone at $($G -C "$C" rev-parse HEAD) exit=$e; origin/claude/fix-2690-ask-row-word $($G -C "$C" rev-parse origin/claude/fix-2690-ask-row-word); origin/main $($G -C "$C" rev-parse origin/main)"
setup "$C" fix; e=$?
st "setup fix (npm ci, workspace build, deep-hook) exit=$e"
if [ $e != 0 ]; then st "STOP: fix setup failed"; exit 1; fi
cd "$C" || exit 1
run() { local out=$1; shift; node node_modules/vitest/vitest.mjs run "$@" > "$O/$out" 2>&1; local e=$?; st "$out: $(cnt "$O/$out") exit=$e"; }
run fix-2690.txt --root tests/acceptance/2690 --no-file-parallelism
run fix-1461-ac27.txt tests/acceptance/1461/rows.test.ts tests/acceptance/1461/redraft/rows.test.ts -t AC27
run fix-1172-rows.txt tests/acceptance/1172/rows.test.ts
run fix-1810-redraft.txt --root tests/acceptance/1810 redraft-replica --no-file-parallelism
run fix-1546-ac1.txt tests/acceptance/1546/ac1-journey.test.ts
run fix-1427-ac7.txt tests/acceptance/1427/ac7-shipped.test.ts
touch "$O/.mark"; sleep 1
cargo test --locked -p deep-replica --test headless replica_equals_live_tree > "$O/fix-1459-ac6-before.txt" 2>&1; e=$?
st "fix-1459-ac6-before.txt: $(ccnt "$O/fix-1459-ac6-before.txt") exit=$e; $(snaps "$C" "$O/fix-replica")"
: > "$O/retake.txt"; ex=""
for v in needs-you sidebar session; do
  echo "===== $v" >> "$O/retake.txt"
  cargo run --locked -p deep-replica --bin deep-live -- --view $v --out docs/spikes/338/out/live/$v.json >> "$O/retake.txt" 2>&1; ex="$ex $v:$?"
done
mkdir -p "$O/live"; cp docs/spikes/338/out/live/{needs-you,sidebar,session}.json "$O/live/"
st "retake: view:exit$ex; files copied: $(ls "$O/live" | xargs)"
$G diff --stat > "$O/live-diff.txt"
st "live-diff: $(tail -1 "$O/live-diff.txt")"
cargo test --locked -p deep-replica --test headless replica_equals_live_tree > "$O/fix-1459-ac6-after.txt" 2>&1; e=$?
st "fix-1459-ac6-after.txt: $(ccnt "$O/fix-1459-ac6-after.txt") exit=$e"
run fix-1459-parity.txt tests/acceptance/1459/parity.test.ts
$G status --porcelain > "$O/git-status-after-fix.txt"
st "fix git status --porcelain lines after (retaken captures included): $(wc -l < "$O/git-status-after-fix.txt" | xargs)"
cd "$R"; rm -rf "$C"; st "clone $C removed"
rm -f "$O/.mark"
{ echo "end $(date '+%F %T') $(uptime)"; } >> "$O/machine.txt"
st "ALL DONE front app [$(front)]"
