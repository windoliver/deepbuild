#!/bin/bash
# #2973 hand e2e: the restart budget on an installed-root hub under a temp HOME (never the real ~/.deepbuild or
# launchd), the login service played by the 2973 suite's stand-in, the OS confirmation by a stub. Token values and
# temp paths are redacted in all output.
set -u
R=$(git rev-parse --show-toplevel)
NODEBIN=$(dirname "$(command -v node)")  # Node 24
NODE=$NODEBIN/node
CLI=$R/packages/cli/dist/main.js
CLIENT=$R/tests/acceptance/2973/fixtures/client.mjs
T=$(mktemp -d /tmp/e2e2973.XXXXXX)
mkdir -p "$T/home" "$T/bin" "$T/launchd"
printf '#!/bin/sh\nT2973_LAUNCHD=%s exec %s %s "$@"\n' "$T/launchd" "$NODE" "$R/tests/acceptance/2973/fixtures/launcher.mjs" > "$T/bin/launcher"
for n in launchctl systemctl; do printf '#!/bin/sh\necho "stand-in %s: not the real service manager" >&2\nexit 1\n' "$n" > "$T/bin/$n"; done
printf '#!/bin/sh\nprintf "%%s\\n" "$1" >> %s\n[ "$(cat %s)" = confirmed ]\n' "$T/asks.log" "$T/confirm.mode" > "$T/bin/confirm"
chmod +x "$T/bin/"*
echo cancelled > "$T/confirm.mode"; : > "$T/asks.log"
E=(env -i HOME="$T/home" PATH="$T/bin:$NODEBIN:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$T/" LC_ALL=C TERM="${TERM:-xterm}" DEEP_HUB_LAUNCHER="$T/bin/launcher" DEEP_HUB_TEST_CONFIRM="$T/bin/confirm")
SOCK="$T/home/.deepbuild/hub.sock"; TOK="$T/home/.deepbuild/control.token"
red() { local t=""; [ -f "$TOK" ] && t=$(cat "$TOK"); if [ -n "$t" ]; then sed -e "s|$t|<token>|g" -e "s|$T|<tmp>|g" -e "s|$HOME|~|g"; else sed -e "s|$T|<tmp>|g" -e "s|$HOME|~|g"; fi; }
deep() { "${E[@]}" "$NODE" "$CLI" "$@"; }
# The hub's start and its restart budget, from hub.health.
hub() { "${E[@]}" "$NODE" "$CLIENT" "$SOCK" "$TOK" hub.health '{}' 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s.trim().split("\n").at(-1)).reply.result;console.log(`hub up: start ${h.start}, restarts left ${h.restarts.left}${h.restarts.frees?`, next frees ${h.restarts.frees}`:""}`)}catch{console.log("hub: not answering")}})' | red; }
raw() { "${E[@]}" "$NODE" "$CLIENT" "$SOCK" "$TOK" "$@" 2>&1 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=s.trim().split("\n").at(-1);try{console.log("reply: "+JSON.stringify(JSON.parse(l).reply))}catch{console.log(l)}})' | red; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
# One hub.restart on the token alone, then the wait until a hub with a new start answers.
start() { hub | sed -n 's/^hub up: start \([0-9A-Z]*\).*/\1/p'; }
restart() {
  local old out i; old=$(start)
  raw hub.restart '{}'
  for i in $(seq 1 90); do sleep 1; out=$(start); [ -n "$out" ] && [ "$out" != "$old" ] && break; done
  echo "  $(hub) (a new start after ${i} s)"
}

step "1. Start the installed hub (temp HOME, stand-in login service)"
deep hub start 2>&1 | red; sleep 1; hub

step "2. Six restarts on the token alone: each spends one of the budget's 6 in any 60 minutes"
for n in 1 2 3 4 5 6; do echo "restart $n:"; restart; done

step "3. The 7th restart is refused, naming the budget, when the next frees up, and deep hub stop / deep hub start"
before=$(start)
raw hub.restart '{}'
echo "waiting 20 s: the hub must stay up with the same start"
sleep 20; hub
[ "$before" = "$(start)" ] && echo "same start as before the 7th restart: the hub stayed up"
echo "exits the login service saw: $(grep -c '"event":"exit"' "$T/launchd/launchd.jsonl")"

step "4. With the budget spent, a confirmed deep hub stop still stops the hub, and deep hub start starts it"
echo confirmed > "$T/confirm.mode"
deep hub stop 2>&1 | red; echo "deep hub stop exit ${PIPESTATUS[0]}"
sleep 3; hub
deep hub start 2>&1 | red; echo "deep hub start exit ${PIPESTATUS[0]}"
for i in $(seq 1 60); do sleep 1; out=$(hub); case "$out" in *"hub up"*) break;; esac; done; echo "$out"

step "5. The budget file under the hub root (times on the hub's clock)"
ls -l "$T/home/.deepbuild/restarts.json" | awk '{print $1, $NF}' | red
"$NODE" -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(`v ${b.v}, ${b.at.length} restarts: ${b.at.map(t=>new Date(t).toISOString().slice(11,19)).join(" ")}`)' "$T/home/.deepbuild/restarts.json"

step "6. Cleanup: stop the hub and the stand-in supervisor this run started, by PID; remove the temp folder"
deep hub stop > /dev/null 2>&1; echo "deep hub stop exit $?"
SUP=$(cat "$T/launchd/supervisor.pid" 2>/dev/null); [ -n "$SUP" ] && kill "$SUP" 2>/dev/null && echo "stopped stand-in supervisor pid $SUP"
rm -rf "$T"; echo "removed <tmp>"
